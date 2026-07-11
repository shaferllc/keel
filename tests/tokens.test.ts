import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { setConnection, clearConnections, type Connection, type Row } from "../src/core/database.js";
import {
  createToken,
  verifyToken,
  revokeToken,
  revokeTokens,
  listTokens,
  tokenAllows,
  tokenDenies,
} from "../src/core/tokens.js";
import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { auth, tokenAuth, token, tokenCan, setUserProvider } from "../src/core/auth.js";

/** A real in-memory SQLite Connection so tokens exercise actual SQL. */
function sqliteConnection(): Connection {
  const sdb = new DatabaseSync(":memory:");
  sdb.exec(`CREATE TABLE personal_access_tokens (
    selector TEXT, hash TEXT, tokenable_id TEXT, name TEXT,
    abilities TEXT, last_used_at INTEGER, expires_at INTEGER, created_at INTEGER
  )`);
  return {
    async select(sql, bindings) {
      return sdb.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = sdb.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
}

test("tokens: create → verify round-trip, with abilities and last-used", async () => {
  clearConnections();
  setConnection(sqliteConnection(), "sqlite");

  const issued = await createToken(42, { abilities: ["posts:read", "posts:write"], name: "CLI" });
  assert.match(issued.token, /^keel_[\w-]+\.[\w-]+$/);
  assert.deepEqual(issued.abilities, ["posts:read", "posts:write"]);

  const record = await verifyToken(issued.token);
  assert.ok(record);
  assert.equal(record.tokenableId, "42");
  assert.equal(record.name, "CLI");
  assert.equal(typeof record.lastUsedAt, "number"); // stamped on verify
  assert.equal(tokenAllows(record, "posts:read"), true);
  assert.equal(tokenAllows(record, "posts:delete"), false);
  assert.equal(tokenDenies(record, "posts:delete"), true);
});

test("tokens: wildcard ability grants everything", async () => {
  clearConnections();
  setConnection(sqliteConnection(), "sqlite");
  const issued = await createToken(1); // default ["*"]
  const record = await verifyToken(issued.token);
  assert.equal(tokenAllows(record, "anything:at:all"), true);
});

test("tokens: rejects garbage, tampered, expired, and revoked tokens", async () => {
  clearConnections();
  setConnection(sqliteConnection(), "sqlite");

  assert.equal(await verifyToken("not-a-token"), null);
  assert.equal(await verifyToken("keel_abc.def"), null); // unknown selector

  const issued = await createToken(7);
  const [prefix, verifier] = issued.token.split(".");
  assert.equal(await verifyToken(`${prefix}.${verifier}x`), null); // tampered verifier

  // Expired: a negative lifetime puts expiry in the past; verify deletes it.
  const expired = await createToken(7, { expiresIn: -10 });
  assert.equal(await verifyToken(expired.token), null);

  // Revoked: gone after revokeToken(selector).
  await revokeToken(issued.selector);
  assert.equal(await verifyToken(issued.token), null);
});

test("tokens: list and revoke-all for an entity", async () => {
  clearConnections();
  setConnection(sqliteConnection(), "sqlite");

  await createToken(99, { name: "a" });
  await createToken(99, { name: "b" });
  await createToken(100, { name: "c" });

  assert.equal((await listTokens(99)).length, 2);
  await revokeTokens(99);
  assert.equal((await listTokens(99)).length, 0);
  assert.equal((await listTokens(100)).length, 1); // untouched
});

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("tokenAuth: 401 without a token, resolves user + abilities with one", async () => {
  clearConnections();
  setConnection(sqliteConnection(), "sqlite");
  setUserProvider((id) => ({ id, name: "Ada" }));

  const issued = await createToken(5, { abilities: ["posts:read"] });

  const hono = await build((r) => {
    r.get("/me", async () =>
      json({ id: auth().id(), user: await auth().user(), canRead: tokenCan("posts:read"), abilities: token()?.abilities }),
    ).use(tokenAuth());
    // A route that demands an ability the token lacks.
    r.get("/admin", json({ ok: true })).use(tokenAuth({ abilities: ["admin"] }));
  });

  assert.equal((await hono.request("/me")).status, 401);

  const res = await hono.request("/me", { headers: { authorization: `Bearer ${issued.token}` } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    id: "5",
    user: { id: "5", name: "Ada" },
    canRead: true,
    abilities: ["posts:read"],
  });

  // Under-scoped token is rejected by an ability-gated route.
  assert.equal(
    (await hono.request("/admin", { headers: { authorization: `Bearer ${issued.token}` } })).status,
    401,
  );
});
