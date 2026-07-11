# Social authentication

"Sign in with GitHub / Google / Discord" — OAuth 2.0, without an SDK. Keel owns
the OAuth handshake only: it hands you a normalized **social user**, and *you*
find-or-create your own user and log them in (with a [session](./authentication.md),
[`jwt`](./authentication.md#token-api-authentication), or an
[access token](./authentication.md#opaque-access-tokens)). It stores nothing.

Every driver is `fetch`-based — no dependencies, no native bindings — so it runs
on Node and the edge alike.

## Configure a provider

```ts
import { social } from "@shaferllc/keel/core";

const github = social.github({
  clientId: config("services.github.id"),
  clientSecret: config("services.github.secret"),
  redirectUri: "https://app.example.com/auth/github/callback",
});
```

Presets: `social.github`, `social.google`, `social.discord`. Each defaults to the
scopes needed for id + email + profile; override with `scopes` in the config or
per-redirect.

## The two-step flow

**1. Redirect** the user to the provider. Generate a `state` for CSRF and stash it
(in the session) to check on the way back:

```ts
import { social, session, redirect } from "@shaferllc/keel/core";

router.get("/auth/github", () => {
  const state = social.state();
  session().put("oauth_state", state);
  return redirect(github.redirect({ state }));
});
```

**2. Handle the callback.** Verify `state`, then exchange the `code` for the user:

```ts
router.get("/auth/github/callback", async () => {
  if (request.query("state") !== session().pull("oauth_state")) {
    throw new ForbiddenException("Invalid OAuth state");
  }

  const gh = await github.user(request.query("code")); // exchange + fetch profile

  const user = await User.query()
    .where("github_id", gh.id)
    .first() ?? await User.create({ github_id: gh.id, email: gh.email, name: gh.name });

  auth().login(user.id);
  return redirect("/dashboard");
});
```

## The social user

`user()` returns a shape that's the same across every provider:

```ts
{
  id: string;            // the provider's stable id (always a string)
  email: string | null;
  name: string | null;
  nickname: string | null;   // handle / username
  avatarUrl: string | null;
  token: OAuthToken;         // { accessToken, refreshToken?, expiresIn?, … }
  raw: Record<string, unknown>; // the untouched provider payload
}
```

Reach `raw` for provider-specific fields not in the normalized shape. Use `token`
to call the provider's API on the user's behalf.

## Issuing your own credential

After you've found-or-created the user, log them in however your app authenticates
— they're independent of the OAuth token:

```ts
// server-rendered app → session
auth().login(user.id);

// SPA / mobile → an opaque access token
const { token } = await createToken(user.id);
return response.json({ token });
```

## Splitting the steps

`user(code)` is `exchangeCode(code)` then `userFromToken(token)`. Call them apart
when you already hold a token (e.g. a native mobile SDK did the OAuth dance):

```ts
const token = await github.exchangeCode(code);   // { accessToken, … }
const gh = await github.userFromToken(token);     // normalized user
```

A failed exchange or profile fetch throws `OAuthError` (with the `provider` name).

## Any other OAuth2 provider

Build a driver for anything OAuth2 with `social.driver(spec, config)` — supply the
`authorizeUrl`, `tokenUrl`, default scopes, and a `fetchUser(token)` that returns a
`SocialUser`:

```ts
const gitlab = social.driver(
  {
    name: "gitlab",
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    defaultScopes: ["read_user"],
    async fetchUser(token) {
      const res = await fetch("https://gitlab.com/api/v4/user", {
        headers: { authorization: `Bearer ${token.accessToken}` },
      });
      const data = await res.json();
      return { id: String(data.id), email: data.email, name: data.name,
               nickname: data.username, avatarUrl: data.avatar_url, token, raw: data };
    },
  },
  { clientId, clientSecret, redirectUri },
);
```
