import { test } from "node:test";
import assert from "node:assert/strict";

import { social, github, google, oauthState, OAuthError } from "../src/core/social.js";

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
      assert.match((init?.headers as Record<string, string>).authorization, /^Bearer gho_abc$/);
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
