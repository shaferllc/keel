import { test } from "node:test";
import assert from "node:assert/strict";

import { social, github, google, twitter, oauthState, oauth1Signature, OAuthError } from "../src/core/social.js";

const config = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://app.test/auth/github/callback",
};

test("redirect() builds a correct authorize URL", () => {
  const url = new URL(github(config).redirect({ state: "xyz", scopes: ["read:user"] }));
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "read:user");
  assert.equal(url.searchParams.get("state"), "xyz");

  // Google defaults + extra params.
  const g = new URL(google(config).redirect({ params: { access_type: "offline" } }));
  assert.equal(g.searchParams.get("scope"), "openid email profile");
  assert.equal(g.searchParams.get("access_type"), "offline");
});

test("oauthState / social.state produce random url-safe strings", () => {
  const a = oauthState();
  const b = social.state();
  assert.match(a, /^[\w-]+$/);
  assert.notEqual(a, b);
});

test("user(code) exchanges the code then normalizes the profile", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://github.com/login/oauth/access_token") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ access_token: "gho_abc", token_type: "bearer", scope: "read:user" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://api.github.com/user") {
      assert.match((init?.headers as Record<string, string>).authorization!, /^Bearer gho_abc$/);
      return new Response(
        JSON.stringify({ id: 583231, login: "octocat", name: "The Octocat", email: "octo@github.com", avatar_url: "https://x/y.png" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const user = await github(config).user("the-code");
    assert.deepEqual(
      { id: user.id, email: user.email, name: user.name, nickname: user.nickname, avatarUrl: user.avatarUrl },
      { id: "583231", email: "octo@github.com", name: "The Octocat", nickname: "octocat", avatarUrl: "https://x/y.png" },
    );
    assert.equal(user.token.accessToken, "gho_abc");
    assert.equal(user.raw.login, "octocat");
    assert.deepEqual(calls, ["https://github.com/login/oauth/access_token", "https://api.github.com/user"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("oauth1Signature matches the canonical Twitter HMAC-SHA1 vector", async () => {
  const signature = await oauth1Signature({
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json",
    params: {
      oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
      oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1318622958",
      oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      oauth_version: "1.0",
      status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      include_entities: "true",
    },
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7QYqcAM",
    tokenSecret: "LswwdoUaIVS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  });
  // Ground truth: node crypto.createHmac("sha1", key).update(base).digest("base64").
  assert.equal(signature, "M+jQZtEgDvjHvm/iWHML/uIS6T4=");
});

test("OAuth 1.0a three-legged flow (request token → access token → user)", async () => {
  const original = globalThis.fetch;
  const seenAuth: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seenAuth.push((init?.headers as Record<string, string>)?.authorization ?? "");
    if (url === "https://api.twitter.com/oauth/request_token") {
      return new Response("oauth_token=reqtok&oauth_token_secret=reqsecret&oauth_callback_confirmed=true", { status: 200 });
    }
    if (url === "https://api.twitter.com/oauth/access_token") {
      return new Response("oauth_token=acctok&oauth_token_secret=accsecret&user_id=123&screen_name=jack", { status: 200 });
    }
    if (url.startsWith("https://api.twitter.com/1.1/account/verify_credentials.json")) {
      return new Response(
        JSON.stringify({ id_str: "123", screen_name: "jack", name: "Jack", email: "jack@x.com", profile_image_url_https: "https://x/p.png" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const tw = twitter({ clientId: "ck", clientSecret: "cs", redirectUri: "https://app.test/cb" });

    const request = await tw.requestToken();
    assert.equal(request.token, "reqtok");
    assert.equal(request.tokenSecret, "reqsecret");
    assert.match(tw.redirect(request), /oauth_token=reqtok/);

    const user = await tw.user("reqtok", "the-verifier", request.tokenSecret);
    assert.deepEqual(
      { id: user.id, email: user.email, name: user.name, nickname: user.nickname, avatarUrl: user.avatarUrl },
      { id: "123", email: "jack@x.com", name: "Jack", nickname: "jack", avatarUrl: "https://x/p.png" },
    );
    assert.equal(user.token.token, "acctok"); // OAuth1Token, not OAuth2

    // Every request was HMAC-SHA1-signed.
    assert.ok(seenAuth.every((h) => /^OAuth .*oauth_signature=/.test(h)));
  } finally {
    globalThis.fetch = original;
  }
});

test("a failed token exchange throws OAuthError", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "bad_verification_code", error_description: "expired" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(() => github(config).user("nope"), (e: Error) => {
      assert.ok(e instanceof OAuthError);
      assert.equal((e as OAuthError).provider, "github");
      assert.match(e.message, /expired/);
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});
