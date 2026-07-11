/**
 * Social authentication — OAuth 2.0 "sign in with GitHub/Google/…". Like Adonis
 * Ally, this owns the OAuth dance only: it hands you a normalized `SocialUser`,
 * and *you* find-or-create your own user and log them in (with a session,
 * `jwt`, or an access `token`). It stores nothing.
 *
 *   const github = social.github({ clientId, clientSecret, redirectUri });
 *
 *   // 1. send the user off to the provider
 *   router.get("/auth/github", () => redirect(github.redirect({ state })));
 *
 *   // 2. handle the callback
 *   router.get("/auth/github/callback", async () => {
 *     const gh = await github.user(request.query("code"));   // { id, email, name, … }
 *     const user = await users.firstOrCreate({ github_id: gh.id }, { email: gh.email });
 *     auth().login(user.id);
 *   });
 *
 * Every driver is `fetch`-based — no SDK, no native deps — so it runs on Node and
 * the edge alike. Presets cover GitHub, Google, and Discord; build your own with
 * `oauthDriver()` for anything else OAuth2.
 */

/** An OAuth token set returned by the provider's token endpoint. */
export interface OAuthToken {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  /** Seconds until the access token expires, if the provider says. */
  expiresIn?: number;
  scope?: string;
  /** The raw token response, for provider-specific fields. */
  raw: Record<string, unknown>;
}

/** A provider's user, normalized to a common shape across every driver. */
export interface SocialUser {
  /** The provider's stable id for this user (always a string). */
  id: string;
  email: string | null;
  name: string | null;
  /** Username / handle (e.g. GitHub login, Discord username). */
  nickname: string | null;
  avatarUrl: string | null;
  /** The token used to fetch this profile — for calling the provider's API. */
  token: OAuthToken;
  /** The raw provider profile, for fields not in the normalized shape. */
  raw: Record<string, unknown>;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** The callback URL registered with the provider. */
  redirectUri: string;
  /** Override the provider's default scopes. */
  scopes?: string[];
}

export interface RedirectOptions {
  /** A CSRF `state` value — generate with `oauthState()`, stash it, verify on callback. */
  state?: string;
  /** Scopes for this redirect (overrides config + provider defaults). */
  scopes?: string[];
  /** Extra query parameters to add to the authorize URL (e.g. `prompt`, `access_type`). */
  params?: Record<string, string>;
}

/** The provider-specific bits an `OAuthDriver` needs. */
export interface ProviderSpec {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  defaultScopes: string[];
  /** How scopes are joined in the URL — space for most, comma for a few. */
  scopeSeparator?: string;
  /** Fetch and normalize the provider's user for an access token. */
  fetchUser(token: OAuthToken): Promise<SocialUser>;
}

/** Thrown when the token exchange or profile fetch fails. */
export class OAuthError extends Error {
  constructor(message: string, readonly provider: string) {
    super(message);
    this.name = "OAuthError";
  }
}

/** A random, URL-safe `state` for CSRF protection — stash it, then verify on callback. */
export function oauthState(bytes = 16): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A generic OAuth 2.0 authorization-code driver. */
export class OAuthDriver {
  constructor(private spec: ProviderSpec, private config: OAuthConfig) {}

  /** Build the provider's authorize URL to redirect the user to. */
  redirect(options: RedirectOptions = {}): string {
    const scopes = options.scopes ?? this.config.scopes ?? this.spec.defaultScopes;
    const url = new URL(this.spec.authorizeUrl);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    if (scopes.length) url.searchParams.set("scope", scopes.join(this.spec.scopeSeparator ?? " "));
    if (options.state) url.searchParams.set("state", options.state);
    for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value);
    return url.toString();
  }

  /** Exchange an authorization `code` (from the callback) for an access token. */
  async exchangeCode(code: string): Promise<OAuthToken> {
    const res = await fetch(this.spec.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.error) {
      throw new OAuthError(
        `Token exchange failed: ${data.error_description ?? data.error ?? res.status}`,
        this.spec.name,
      );
    }
    return {
      accessToken: String(data.access_token),
      tokenType: data.token_type as string | undefined,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
      scope: data.scope as string | undefined,
      raw: data,
    };
  }

  /** Fetch the normalized user for an already-obtained access token. */
  userFromToken(token: OAuthToken): Promise<SocialUser> {
    return this.spec.fetchUser(token);
  }

  /** The full callback step: exchange the `code`, then fetch the user. */
  async user(code: string): Promise<SocialUser> {
    return this.userFromToken(await this.exchangeCode(code));
  }
}

/** Build a driver for any OAuth2 provider from a spec + config. */
export function oauthDriver(spec: ProviderSpec, config: OAuthConfig): OAuthDriver {
  return new OAuthDriver(spec, config);
}

/* -------------------------------- helpers ------------------------------- */

async function getJson(url: string, token: OAuthToken, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token.accessToken}`, accept: "application/json", ...headers },
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/* ------------------------------- providers ------------------------------ */

/** GitHub OAuth (`user:email` gives access to a verified primary email). */
export function github(config: OAuthConfig): OAuthDriver {
  return new OAuthDriver(
    {
      name: "github",
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      defaultScopes: ["read:user", "user:email"],
      async fetchUser(token) {
        const headers = { "user-agent": "keel", accept: "application/vnd.github+json" };
        const data = await getJson("https://api.github.com/user", token, headers);
        let email = (data.email as string | null) ?? null;
        if (!email) {
          // The public profile hides email unless set — pull the verified primary.
          const emails = (await getJson("https://api.github.com/user/emails", token, headers)) as unknown as
            | { email: string; primary: boolean; verified: boolean }[]
            | Record<string, unknown>;
          if (Array.isArray(emails)) {
            email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
          }
        }
        return {
          id: String(data.id),
          email,
          name: (data.name as string | null) ?? null,
          nickname: (data.login as string | null) ?? null,
          avatarUrl: (data.avatar_url as string | null) ?? null,
          token,
          raw: data,
        };
      },
    },
    config,
  );
}

/** Google OAuth / OpenID Connect. */
export function google(config: OAuthConfig): OAuthDriver {
  return new OAuthDriver(
    {
      name: "google",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      defaultScopes: ["openid", "email", "profile"],
      async fetchUser(token) {
        const data = await getJson("https://openidconnect.googleapis.com/v1/userinfo", token);
        return {
          id: String(data.sub),
          email: (data.email as string | null) ?? null,
          name: (data.name as string | null) ?? null,
          nickname: (data.given_name as string | null) ?? (data.email as string | null) ?? null,
          avatarUrl: (data.picture as string | null) ?? null,
          token,
          raw: data,
        };
      },
    },
    config,
  );
}

/** Discord OAuth. */
export function discord(config: OAuthConfig): OAuthDriver {
  return new OAuthDriver(
    {
      name: "discord",
      authorizeUrl: "https://discord.com/oauth2/authorize",
      tokenUrl: "https://discord.com/api/oauth2/token",
      defaultScopes: ["identify", "email"],
      async fetchUser(token) {
        const data = await getJson("https://discord.com/api/users/@me", token);
        const id = String(data.id);
        const avatar = data.avatar as string | null;
        return {
          id,
          email: (data.email as string | null) ?? null,
          name: (data.global_name as string | null) ?? (data.username as string | null) ?? null,
          nickname: (data.username as string | null) ?? null,
          avatarUrl: avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : null,
          token,
          raw: data,
        };
      },
    },
    config,
  );
}

/** All social providers under one namespace: `social.github({...})`. */
export const social = { github, google, discord, driver: oauthDriver, state: oauthState };
