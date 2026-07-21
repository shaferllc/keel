import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { session, sessionMiddleware, type SessionOptions } from "../src/core/session.js";
import { auth } from "../src/core/auth.js";

const KEY = "test-app-key-do-not-use-in-production";

async function build(
  configure: (r: Router) => void,
  options: SessionOptions = {},
  key: string = KEY,
) {
  const app = new Application();
  // "" means: boot with no app.key at all. Note `Application`'s constructor calls
  // setApplication(this), so the most recently built app is the one config() sees —
  // these must be built in the order the requests need them.
  await app.boot([], { discoverConfig: false, config: { app: key ? { key } : {} } });
  configure(app.make(Router));
  const kernel = new HttpKernel(app);
  kernel.use(sessionMiddleware(options));
  return kernel.build();
}

/** Encode a payload the way an attacker would: base64 JSON, no signature. */
const forge = (data: unknown): string =>
  Buffer.from(JSON.stringify(data)).toString("base64");

/* --------------------------- the auth bypass ------------------------------ */

test("a forged session cookie cannot authenticate as another user", async () => {
  const hono = await build((r) => {
    r.get("/login", () => {
      auth().login(7);
      return json({ ok: true });
    });
    r.get("/whoami", () => json({ id: auth().id() }));
  });

  // A real login works, and the cookie is not readable plaintext JSON.
  const login = await hono.request("/login");
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  assert.deepEqual(await (await hono.request("/whoami", { headers: { cookie } })).json(), {
    id: "7",
  });

  // The attack: hand-write the session payload and claim to be user 1. Before
  // signing, the server took this at face value and answered `{"id":"1"}`.
  const forged = `keel_session=${forge({ auth_id: "1" })}`;
  assert.deepEqual(await (await hono.request("/whoami", { headers: { cookie: forged } })).json(), {
    id: null,
  });
});

test("editing a legitimately-signed cookie invalidates it", async () => {
  const hono = await build((r) => {
    r.get("/login", () => {
      auth().login(7);
      return json({ ok: true });
    });
    r.get("/whoami", () => json({ id: auth().id() }));
  });

  const cookie = (await hono.request("/login")).headers.get("set-cookie")!.split(";")[0]!;
  const value = decodeURIComponent(cookie.slice("keel_session=".length));
  const [payload, signature] = value.split(".");

  // Keep the real signature, swap the payload it was computed over.
  const tampered = `keel_session=${forge({ auth_id: "1" })}.${signature}`;
  assert.deepEqual(await (await hono.request("/whoami", { headers: { cookie: tampered } })).json(), {
    id: null,
  });

  // And the reverse: real payload, a signature invented by the attacker.
  const badSig = `keel_session=${payload}.${"0".repeat(signature!.length)}`;
  assert.deepEqual(await (await hono.request("/whoami", { headers: { cookie: badSig } })).json(), {
    id: null,
  });
});

test("a cookie signed with a different key is rejected", async () => {
  const mine = await build((r) => {
    r.get("/set", () => {
      session().put("who", "me");
      return json({ ok: true });
    });
  });
  // Mint the cookie while *this* app is the active one…
  const cookie = (await mine.request("/set")).headers.get("set-cookie")!.split(";")[0]!;

  // …then stand up an app with a different key and hand it that cookie.
  const theirs = await build(
    (r) => r.get("/read", () => json({ who: session().get("who", null) })),
    {},
    "a-completely-different-key",
  );
  assert.deepEqual(await (await theirs.request("/read", { headers: { cookie } })).json(), {
    who: null,
  });
});

test("an unsigned legacy cookie is rejected rather than trusted", async () => {
  const hono = await build((r) =>
    r.get("/read", () => json({ who: session().get("who", null) })),
  );

  // Exactly what versions before the fix wrote: bare base64, no signature.
  const legacy = `keel_session=${forge({ who: "me" })}`;
  assert.deepEqual(await (await hono.request("/read", { headers: { cookie: legacy } })).json(), {
    who: null,
  });
});

/* ------------------------------ the secure flag ---------------------------- */

test("the cookie is marked Secure over https, but not over plain http", async () => {
  const hono = await build((r) =>
    r.get("/set", () => {
      session().put("a", 1);
      return json({ ok: true });
    }),
  );

  const insecure = (await hono.request("http://local.test/set")).headers.get("set-cookie")!;
  assert.ok(!/Secure/i.test(insecure), `localhost dev must still work: ${insecure}`);

  const secure = (await hono.request("https://app.example/set")).headers.get("set-cookie")!;
  assert.match(secure, /Secure/i);
});

test("a TLS-terminating proxy still gets a Secure cookie", async () => {
  const hono = await build((r) =>
    r.get("/set", () => {
      session().put("a", 1);
      return json({ ok: true });
    }),
  );

  // The proxy speaks https to the world and http to us; only the header says so.
  const res = await hono.request("http://app.internal/set", {
    headers: { "x-forwarded-proto": "https" },
  });
  assert.match(res.headers.get("set-cookie")!, /Secure/i);
});

test("an explicit cookie.secure overrides the inferred value", async () => {
  const hono = await build(
    (r) =>
      r.get("/set", () => {
        session().put("a", 1);
        return json({ ok: true });
      }),
    { cookie: { secure: true } },
  );

  assert.match((await hono.request("http://local.test/set")).headers.get("set-cookie")!, /Secure/i);
});

/* -------------------------------- failing closed --------------------------- */

test("without an app key the session fails closed rather than going unsigned", async () => {
  const hono = await build(
    (r) =>
      r.get("/set", () => {
        session().put("a", 1);
        return json({ ok: true });
      }),
    {},
    "", // no config('app.key')
  );

  const res = await hono.request("/set");
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("set-cookie"), null); // never writes an unsigned cookie
});
