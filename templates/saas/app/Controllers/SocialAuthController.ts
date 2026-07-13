import type { Ctx, SocialUser } from "@shaferllc/keel/core";
import {
  ForbiddenException,
  auth,
  config,
  hash,
  logger,
  session,
  social,
} from "@shaferllc/keel/core";

import { User } from "../Models/User.js";

export const PROVIDERS = ["github", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * The providers that actually have credentials. The login page asks this before it
 * renders a button, so an unconfigured app simply doesn't offer social sign-in.
 */
export function configuredProviders(): Provider[] {
  return PROVIDERS.filter((p) => !!config(`services.${p}.id`));
}

function driver(provider: Provider) {
  const id = String(config(`services.${provider}.id`, ""));
  const secret = String(config(`services.${provider}.secret`, ""));
  const redirectUri = String(config(`services.${provider}.redirect`, ""));

  // Reachable only by hitting /auth/github directly on an app with no credentials.
  // A 403 beats bouncing the user to the provider's own error page.
  if (!id || !secret) throw new ForbiddenException(`${provider} sign-in is not configured`);

  return social[provider]({ clientId: id, clientSecret: secret, redirectUri });
}

/**
 * "Sign in with GitHub / Google."
 *
 * Keel owns the OAuth handshake and hands back a normalized user; turning that into a
 * local account is the app's job — and it is where every interesting decision lives.
 * Both of them are below.
 */
export class SocialAuthController {
  /** Step 1 — bounce to the provider, carrying a `state` we can recognize later. */
  async redirect(c: Ctx) {
    const provider = this.provider(c);
    const state = social.state();

    // Stashed server-side so the value coming back can be compared against one only we
    // could have issued. Without it, an attacker sends you a callback URL bearing
    // *their* code and you are quietly signed into *their* account.
    session().put(`oauth_state:${provider}`, state);

    return c.redirect(driver(provider).redirect({ state }));
  }

  /** Step 2 — check the state, exchange the code, find-or-create, log in. */
  async callback(c: Ctx) {
    const provider = this.provider(c);

    const expected = session().pull(`oauth_state:${provider}`);
    const actual = c.req.query("state");

    // `pull` removes it, so a state is single-use and a replayed callback matches
    // nothing. The `!expected` guard earns its keep on its own: without it a *missing*
    // state on both sides compares equal and sails through.
    if (!expected || expected !== actual) throw new ForbiddenException("Invalid OAuth state");

    const code = c.req.query("code");
    if (!code) throw new ForbiddenException("No authorization code");

    const user = await this.findOrCreate(provider, await driver(provider).user(code));

    auth().login(user.id);
    return c.redirect("/teams");
  }

  /**
   * Provider id first, email second — and that order is the whole security argument.
   *
   * A provider's id is stable and unforgeable. An email address is neither: anyone can
   * put ceo@company.com on their GitHub profile. Matching on email first would mean
   * "set your GitHub email to the CEO's, sign in, become the CEO" — and in a
   * multi-tenant app, become the CEO *of their team*.
   *
   * So email is only ever used to link an account whose owner already proved they hold
   * that address, and only when the provider states the address is verified. If we
   * can't get a clear yes, we neither link nor quietly create a second account on a
   * taken address — we stop and say so.
   */
  private async findOrCreate(provider: Provider, profile: SocialUser): Promise<User> {
    const column = `${provider}_id` as "github_id" | "google_id";

    // `newQuery()` rather than `query()`: it hydrates rows into User models, so `save()`
    // and the typed columns below are actually there.
    const linked = await User.newQuery<User>().where(column, profile.id).first();
    if (linked) return linked;

    if (profile.email) {
      const existing = await User.newQuery<User>().where("email", profile.email).first();

      if (existing) {
        if (!(await this.emailIsVerified(provider, profile))) {
          // The address belongs to a local account and the provider won't vouch for it.
          // Linking would be account takeover; creating would violate the unique index
          // on `email` and 500. Neither — tell them the safe way in.
          throw new ForbiddenException(
            `An account already exists for ${profile.email}. Sign in with your password, ` +
              `then connect ${provider} from your dashboard.`,
          );
        }

        existing[column] = profile.id;
        if (!existing.avatar_url && profile.avatarUrl) existing.avatar_url = profile.avatarUrl;
        await existing.save();

        logger().info("linked social account", { provider, userId: existing.id });
        return existing;
      }
    }

    return User.create({
      name: profile.name ?? profile.nickname ?? "New user",
      // GitHub lets a user hide their email. A routable-looking address would be a lie,
      // so use a reserved one they can change later.
      email: profile.email ?? `${provider}_${profile.id}@users.noreply.local`,
      // `password` is NOT NULL and this account has none. A random hash nobody was ever
      // told cannot be guessed, so password login simply never succeeds for them —
      // "forgot password" is the supported way to add one.
      password: await hash.make(`${crypto.randomUUID()}${crypto.randomUUID()}`),
      [column]: profile.id,
      avatar_url: profile.avatarUrl,
    } as never);
  }

  /**
   * Did the provider actually verify this address?
   *
   * This gates account linking, so the price of guessing wrong is account takeover:
   * anything short of an explicit yes is a no, including "the check itself failed".
   *
   * Google is easy — `email_verified` is a standard OIDC claim, and the driver leaves
   * it in `raw`. GitHub tells us nothing: `raw` is the /user payload, which carries no
   * verification flag, and the driver's own fallback will happily return an
   * *unverified* address when the profile email is hidden. So ask GitHub directly, and
   * require that this exact address come back marked verified.
   */
  private async emailIsVerified(provider: Provider, profile: SocialUser): Promise<boolean> {
    if (provider === "google") {
      return (profile.raw as Record<string, unknown>).email_verified === true;
    }

    try {
      const response = await fetch("https://api.github.com/user/emails", {
        headers: {
          authorization: `Bearer ${profile.token.accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "keel",
        },
      });
      if (!response.ok) return false;

      const emails = (await response.json()) as Array<{ email?: string; verified?: boolean }>;
      return (
        Array.isArray(emails) && emails.some((e) => e.email === profile.email && e.verified === true)
      );
    } catch (error) {
      // A network blip must fail closed. Reading "couldn't check" as "verified" is
      // precisely the bug this method exists to prevent.
      logger().warn("could not confirm GitHub email verification", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private provider(c: Ctx): Provider {
    const value = c.req.param("provider");
    if (!PROVIDERS.includes(value as Provider)) throw new ForbiddenException("Unknown provider");
    return value as Provider;
  }
}
