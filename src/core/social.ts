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

/**
 * A provider's user, normalized to a common shape across every driver. `Token`
 * is the OAuth2 `OAuthToken` by default, or an `OAuth1Token` for OAuth 1.0a
 * providers.
 */
export interface SocialUser<Token = OAuthToken> {
  /** The provider's stable id for this user (always a string). */
  id: string;
  email: string | null;
  name: string | null;
  /** Username / handle (e.g. GitHub login, Discord username). */
  nickname: string | null;
  avatarUrl: string | null;
  /** The token used to fetch this profile — for calling the provider's API. */
  token: Token;
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

/* ------------------------------- OAuth 1.0a ------------------------------ */

/*
 * The older, three-legged OAuth 1.0a flow (Twitter/X, Trello, some enterprise
 * APIs). Every request is HMAC-SHA1-signed — done here with Web Crypto, so it's
 * edge-native too. The flow: get a temporary *request token*, send the user to
 * authorize, then swap the returned `oauth_verifier` for an *access token*.
 */

export interface OAuth1Config {
  /** Consumer (API) key. */
  clientId: string;
  /** Consumer (API) secret. */
  clientSecret: string;
  /** The `oauth_callback` URL registered with the provider. */
  redirectUri: string;
}

/** An OAuth 1.0a token pair — both the request token and the final access token. */
export interface OAuth1Token {
  token: string;
  tokenSecret: string;
  raw: Record<string, string>;
}

export interface OAuth1ProviderSpec {
  name: string;
  requestTokenUrl: string;
  authorizeUrl: string;
  accessTokenUrl: string;
  fetchUser(token: OAuth1Token, driver: OAuth1Driver): Promise<SocialUser<OAuth1Token>>;
}

/** Percent-encode per RFC 3986 (OAuth's stricter rules — encodes `!*'()` too). */
function pctEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function hmacSha1(base: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(base) as unknown as ArrayBuffer);
  return bytesToB64(new Uint8Array(sig));
}

/**
 * Compute an OAuth 1.0a HMAC-SHA1 signature (RFC 5849). `params` holds every
 * signed parameter with *raw* (unencoded) values — the oauth_* fields plus any
 * query/body params, minus `oauth_signature`. Exposed for signing custom API
 * requests beyond the built-in flow.
 */
export async function oauth1Signature(input: {
  method: string;
  url: string;
  params: Record<string, string>;
  consumerSecret: string;
  tokenSecret?: string;
}): Promise<string> {
  const paramString = Object.keys(input.params)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(input.params[k]!)}`)
    .join("&");
  const baseUrl = input.url.split(/[?#]/)[0]!; // the base string excludes query/fragment
  const base = [input.method.toUpperCase(), pctEncode(baseUrl), pctEncode(paramString)].join("&");
  const key = `${pctEncode(input.consumerSecret)}&${pctEncode(input.tokenSecret ?? "")}`;
  return hmacSha1(base, key);
}

function oauthNonce(): string {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(16))).replace(/[^A-Za-z0-9]/g, "");
}

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const i = pair.indexOf("=");
    if (i === -1) continue;
    out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}

/** A generic OAuth 1.0a driver. */
export class OAuth1Driver {
  constructor(private spec: OAuth1ProviderSpec, private config: OAuth1Config) {}

  /** Sign a request and build its `Authorization: OAuth …` header. */
  private async authHeader(
    method: string,
    url: string,
    extraOauth: Record<string, string>,
    tokenSecret: string,
    queryParams: Record<string, string> = {},
  ): Promise<string> {
    const oauth: Record<string, string> = {
      oauth_consumer_key: this.config.clientId,
      oauth_nonce: oauthNonce(),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_version: "1.0",
      ...extraOauth,
    };
    const signature = await oauth1Signature({
      method,
      url,
      params: { ...oauth, ...queryParams },
      consumerSecret: this.config.clientSecret,
      tokenSecret,
    });
    const header: Record<string, string> = { ...oauth, oauth_signature: signature };
    return (
      "OAuth " +
      Object.keys(header)
        .sort()
        .map((k) => `${pctEncode(k)}="${pctEncode(header[k]!)}"`)
        .join(", ")
    );
  }

  /** Step 1 — obtain a temporary request token. Stash its `tokenSecret` for the callback. */
  async requestToken(): Promise<OAuth1Token> {
    const header = await this.authHeader("POST", this.spec.requestTokenUrl, { oauth_callback: this.config.redirectUri }, "");
    const res = await fetch(this.spec.requestTokenUrl, { method: "POST", headers: { authorization: header } });
    const body = await res.text();
    if (!res.ok) throw new OAuthError(`Request token failed: ${res.status} ${body}`, this.spec.name);
    const parsed = parseForm(body);
    return { token: parsed.oauth_token ?? "", tokenSecret: parsed.oauth_token_secret ?? "", raw: parsed };
  }

  /** Step 2 — the URL to send the user to, carrying the request token. */
  redirect(requestToken: string | OAuth1Token): string {
    const t = typeof requestToken === "string" ? requestToken : requestToken.token;
    const url = new URL(this.spec.authorizeUrl);
    url.searchParams.set("oauth_token", t);
    return url.toString();
  }

  /** Step 3 — swap the callback's `oauth_token` + `oauth_verifier` for an access token. */
  async accessToken(oauthToken: string, verifier: string, requestTokenSecret: string): Promise<OAuth1Token> {
    const header = await this.authHeader(
      "POST",
      this.spec.accessTokenUrl,
      { oauth_token: oauthToken, oauth_verifier: verifier },
      requestTokenSecret,
    );
    const res = await fetch(this.spec.accessTokenUrl, { method: "POST", headers: { authorization: header } });
    const body = await res.text();
    if (!res.ok) throw new OAuthError(`Access token failed: ${res.status} ${body}`, this.spec.name);
    const parsed = parseForm(body);
    return { token: parsed.oauth_token ?? "", tokenSecret: parsed.oauth_token_secret ?? "", raw: parsed };
  }

  /** The full callback step: exchange for an access token, then fetch the user. */
  async user(oauthToken: string, verifier: string, requestTokenSecret: string): Promise<SocialUser<OAuth1Token>> {
    const token = await this.accessToken(oauthToken, verifier, requestTokenSecret);
    return this.spec.fetchUser(token, this);
  }

  /** A signed GET against the provider's API on the user's behalf (for `fetchUser`). */
  async get(url: string, token: OAuth1Token): Promise<Record<string, unknown>> {
    const query: Record<string, string> = {};
    new URL(url).searchParams.forEach((v, k) => (query[k] = v));
    const header = await this.authHeader("GET", url, { oauth_token: token.token }, token.tokenSecret, query);
    const res = await fetch(url, { headers: { authorization: header } });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }
}

/** Build a driver for any OAuth 1.0a provider from a spec + config. */
export function oauth1Driver(spec: OAuth1ProviderSpec, config: OAuth1Config): OAuth1Driver {
  return new OAuth1Driver(spec, config);
}

/** Twitter / X (OAuth 1.0a). Enable "Request email" in your app settings for `email`. */
export function twitter(config: OAuth1Config): OAuth1Driver {
  return new OAuth1Driver(
    {
      name: "twitter",
      requestTokenUrl: "https://api.twitter.com/oauth/request_token",
      authorizeUrl: "https://api.twitter.com/oauth/authenticate",
      accessTokenUrl: "https://api.twitter.com/oauth/access_token",
      async fetchUser(token, driver) {
        const data = await driver.get(
          "https://api.twitter.com/1.1/account/verify_credentials.json?include_email=true",
          token,
        );
        return {
          id: String(data.id_str ?? data.id),
          email: (data.email as string | null) ?? null,
          name: (data.name as string | null) ?? null,
          nickname: (data.screen_name as string | null) ?? null,
          avatarUrl: (data.profile_image_url_https as string | null) ?? null,
          token,
          raw: data,
        };
      },
    },
    config,
  );
}

/** All social providers under one namespace: `social.github({...})`, `social.twitter({...})`. */
export const social = {
  // OAuth 2.0
  github,
  google,
  discord,
  driver: oauthDriver,
  state: oauthState,
  // OAuth 1.0a
  twitter,
  driver1: oauth1Driver,
};
