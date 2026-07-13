// Type-check harness for docs/social-auth.md. Compile-only — never executed.
import {
  social,
  session,
  redirect,
  request,
  auth,
  ForbiddenException,
  Model,
  config,
} from "@shaferllc/keel/core";

class User extends Model {
  static override table = "users";
  declare id: number;
  declare email: string | null;
  declare name: string | null;
  declare github_id: string;
  declare twitter_id: string;
}

const github = social.github({
  clientId: config("services.github.id") as string,
  clientSecret: config("services.github.secret") as string,
  redirectUri: "https://app.example.com/auth/github/callback",
});

const twitter = social.twitter({
  clientId: config("services.twitter.key") as string,
  clientSecret: config("services.twitter.secret") as string,
  redirectUri: "https://app.example.com/auth/twitter/callback",
});

export function redirectToGithub() {
  const state = social.state();
  session().put("oauth_state", state);
  return redirect(github.redirect({ state }));
}

export async function githubCallback() {
  const state = String(request.query("state") ?? "");
  if (state !== session().pull("oauth_state")) {
    throw new ForbiddenException("Invalid OAuth state");
  }

  const code = String(request.query("code") ?? "");
  const gh = await github.user(code);
  const existing = await User.query().where("github_id", gh.id).first();
  const user =
    existing ??
    (await User.create({ github_id: gh.id, email: gh.email, name: gh.name }));

  auth().login(user.id as number);
  return redirect("/dashboard");
}

export async function twitterFlow() {
  const requestToken = await twitter.requestToken();
  session().put("twitter_secret", requestToken.tokenSecret);
  const toProvider = redirect(twitter.redirect(requestToken));

  const tw = await twitter.user(
    String(request.query("oauth_token") ?? ""),
    String(request.query("oauth_verifier") ?? ""),
    String(session().pull("twitter_secret") ?? ""),
  );
  const user = await User.firstOrCreate({ twitter_id: tw.id }, { name: tw.name });
  auth().login(user.id as number);
  return { toProvider, user };
}

export async function tokenReuse() {
  const code = String(request.query("code") ?? "");
  const token = await github.exchangeCode(code);
  return github.userFromToken(token);
}
