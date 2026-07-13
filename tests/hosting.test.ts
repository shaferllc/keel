import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { Application } from "../src/core/application.js";
import {
  setConnection,
  clearConnections,
  type Connection,
  type Row,
} from "../src/core/database.js";
import {
  cloudflareConfigured,
  normalizeHostname,
  isValidHostname,
  zoneCandidates,
  dumpConnection,
  normalizeSecretKey,
  encryptSecretValue,
  decryptSecretValue,
  resolveSecretRows,
} from "../src/hosting/index.js";

test("hosting: hostname normalize / validate / zone candidates", () => {
  assert.equal(normalizeHostname("https://App.Example.com/path"), "app.example.com");
  assert.equal(normalizeHostname("APP.EXAMPLE.COM."), "app.example.com");
  assert.equal(isValidHostname("app.example.com"), true);
  assert.equal(isValidHostname("not a host"), false);
  assert.equal(isValidHostname("localhost"), false);
  assert.deepEqual(zoneCandidates("a.b.example.com"), [
    "a.b.example.com",
    "b.example.com",
    "example.com",
  ]);
  assert.deepEqual(zoneCandidates("localhost"), []);
});

test("hosting: cloudflareConfigured requires account + token", () => {
  assert.equal(cloudflareConfigured({}), false);
  assert.equal(cloudflareConfigured({ accountId: "a" }), false);
  assert.equal(cloudflareConfigured({ accountId: "a", apiToken: "t" }), true);
});

test("hosting: dumpConnection emits schema + rows", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
  db.exec("INSERT INTO notes (body) VALUES ('hello')");
  const conn: Connection = {
    async select(sql, bindings) {
      return db.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = db.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };

  const sql = await dumpConnection(conn, "test dump", { generatedBy: "test" });
  assert.match(sql, /-- test dump/);
  assert.match(sql, /CREATE TABLE notes/);
  assert.match(sql, /INSERT INTO "notes"/);
  assert.match(sql, /'hello'/);
  assert.match(sql, /COMMIT;/);
});

test("hosting: secret encrypt / decrypt / resolve round-trip", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { key: "test-secret-key" } } });

  assert.equal(normalizeSecretKey("stripe-secret-key"), "STRIPE_SECRET_KEY");

  const encrypted = await encryptSecretValue("sk_live_x", "app-secret");
  assert.notEqual(encrypted, "sk_live_x");
  assert.equal(await decryptSecretValue(encrypted, "app-secret"), "sk_live_x");
  assert.equal(await decryptSecretValue(encrypted, "other"), null);

  const env = await resolveSecretRows(
    [{ key: "STRIPE_SECRET_KEY", value_encrypted: encrypted }],
    "app-secret",
  );
  assert.deepEqual(env, { STRIPE_SECRET_KEY: "sk_live_x" });
});
