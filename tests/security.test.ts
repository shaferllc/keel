import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json, text } from "../src/core/request.js";
import { sessionMiddleware } from "../src/core/session.js";
import { cors } from "../src/core/cors.js";
import { securityHeaders } from "../src/core/shield.js";
import { csrf, csrfToken } from "../src/core/csrf.js";
import { rateLimiter } from "../src/core/rate-limit.js";
import { encryption } from "../src/core/crypto.js";

async function build(
  setup: (kernel: HttpKernel) => void,
  configure: (r: Router) => void,
  config: Record<string, unknown> = { app: {} },
) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config });
  configure(app.make(Router));
  const kernel = new HttpKernel(app);
  setup(kernel);
  return kernel.build();
}

/* ---------------------------------- CORS -------------------------------- */

test("cors: preflight and simple requests", async () => {
  const hono = await build(
    (k) => k.use(cors({ origin: ["https://app.test"], credentials: true, methods: ["GET", "POST"] })),
    (r) => r.get("/api", json({ ok: true })),
  );

  // Preflight from an allowed origin → 204 with CORS headers.
  const pre = await hono.request("/api", {
    method: "OPTIONS",
    headers: { origin: "https://app.test", "access-control-request-method": "POST" },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://app.test");
  assert.match(pre.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.equal(pre.headers.get("access-control-allow-credentials"), "true");

  // Simple request from the allowed origin → header reflected.
  const ok = await hono.request("/api", { headers: { origin: "https://app.test" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://app.test");

  // A different origin is not allowed.
  const bad = await hono.request("/api", { headers: { origin: "https://evil.test" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("cors: credentials downgrades '*' to the concrete origin", async () => {
  const hono = await build(
    (k) => k.use(cors({ origin: "*", credentials: true })),
    (r) => r.get("/x", json({ ok: true })),
  );
  const res = await hono.request("/x", { headers: { origin: "https://a.test" } });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://a.test"); // not "*"
});

/* ----------------------------- security headers ------------------------- */

test("securityHeaders: sets the defensive headers", async () => {
  const hono = await build(
    (k) =>
      k.use(
        securityHeaders({
          csp: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "https://cdn.test"] },
          hsts: { maxAge: 100, includeSubDomains: true },
          frameGuard: "DENY",
        }),
      ),
    (r) => r.get("/", html()),
  );
  const res = await hono.request("/");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'self'; script-src 'self' https://cdn.test");
  assert.equal(res.headers.get("strict-transport-security"), "max-age=100; includeSubDomains");
});

function html() {
  return () => text("<h1>hi</h1>");
}

/* ---------------------------------- CSRF -------------------------------- */

test("csrf: rejects unsafe requests without a token, accepts with one", async () => {
  const hono = await build(
    (k) => {
      k.use(sessionMiddleware());
      k.use(csrf({ except: ["/webhook*"] }));
    },
    (r) => {
      r.get("/form", () => json({ token: csrfToken() }));
      r.post("/save", json({ saved: true }));
      r.post("/webhook/stripe", json({ ok: true }));
    },
  );

  // GET issues a token + session cookie.
  const form = await hono.request("/form");
  const token = ((await form.json()) as { token: string }).token;
  const setCookies = form.headers.getSetCookie();
  const cookie = setCookies.find((x) => x.startsWith("keel_session"))!.split(";")[0];
  assert.ok(setCookies.some((x) => x.startsWith("XSRF-TOKEN=")));

  // POST without a token → 419.
  assert.equal((await hono.request("/save", { method: "POST", headers: { cookie } })).status, 419);

  // POST with the header token → 200.
  const ok = await hono.request("/save", {
    method: "POST",
    headers: { cookie, "x-csrf-token": token },
  });
  assert.equal(ok.status, 200);

  // Excepted webhook path skips verification.
  assert.equal((await hono.request("/webhook/stripe", { method: "POST", headers: { cookie } })).status, 200);
});

/* -------------------------------- rate limit ---------------------------- */

test("rateLimiter: emits X-RateLimit-Reset", async () => {
  const hono = await build(
    (k) => k.use(rateLimiter({ max: 2, window: 60 })),
    (r) => r.get("/", json({ ok: true })),
  );
  const res = await hono.request("/");
  assert.equal(res.headers.get("x-ratelimit-limit"), "2");
  assert.equal(res.headers.get("x-ratelimit-remaining"), "1");
  assert.match(res.headers.get("x-ratelimit-reset") ?? "", /^\d+$/);
});

/* ------------------------ encryption expiresIn/purpose ------------------ */

test("encryption: expiresIn and purpose binding", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { key: "test-secret-key" } } });

  // Round-trip a plain value (legacy-compatible envelope).
  const plain = await encryption.encrypt({ userId: 1 });
  assert.deepEqual(await encryption.decrypt(plain), { userId: 1 });

  // Expired → null.
  const expired = await encryption.encrypt("secret", { expiresIn: -10 });
  assert.equal(await encryption.decrypt(expired), null);

  // Purpose must match.
  const scoped = await encryption.encrypt({ id: 7 }, { purpose: "password-reset" });
  assert.deepEqual(await encryption.decrypt(scoped, { purpose: "password-reset" }), { id: 7 });
  assert.equal(await encryption.decrypt(scoped, { purpose: "login" }), null);
  assert.equal(await encryption.decrypt(scoped), null); // purpose required but not supplied
});
