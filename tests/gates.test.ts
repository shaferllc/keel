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
import { Migrator } from "../src/core/migrations.js";
import {
  InviteCode,
  EmailAllowlist,
  canRegister,
  redeemInvite,
  gatesMigration,
} from "../src/gates/models.js";

async function setup(): Promise<void> {
  new Application();
  clearConnections();
  const db = new DatabaseSync(":memory:");
  const conn: Connection = {
    async select(sql, bindings) {
      return db.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = db.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
  setConnection(conn, "sqlite");
  await new Migrator(conn, "sqlite").up([gatesMigration()]);
}

test("gates: allowlisted email may register without a code", async () => {
  await setup();
  await EmailAllowlist.create({ email: "ada@example.com" });

  const gate = await canRegister("Ada@Example.com");
  assert.deepEqual(gate, { ok: true, via: "allowlist" });
});

test("gates: valid invite code may register; redeem increments uses", async () => {
  await setup();
  const invite = await InviteCode.create({
    code: "ALPHA-42",
    max_uses: 2,
    uses: 0,
    expires_at: null,
  });

  const gate = await canRegister("bob@example.com", "ALPHA-42");
  assert.equal(gate.ok, true);
  if (!gate.ok || gate.via !== "code") throw new Error("expected code");
  assert.equal(gate.invite!.id, invite.id);

  await redeemInvite(gate.invite!);
  const reloaded = await InviteCode.findOrFail(invite.id);
  assert.equal(reloaded.uses, 1);
});

test("gates: reject missing / invalid / exhausted / expired codes", async () => {
  await setup();

  const missing = await canRegister("x@y.com");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /invite code or allowlisted/);

  assert.equal((await canRegister("x@y.com", "NOPE")).ok, false);

  await InviteCode.create({
    code: "USED",
    max_uses: 1,
    uses: 1,
    expires_at: null,
  });
  const used = await canRegister("x@y.com", "USED");
  assert.equal(used.ok, false);
  if (!used.ok) assert.match(used.reason, /used up/);

  await InviteCode.create({
    code: "OLD",
    max_uses: 5,
    uses: 0,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const expired = await canRegister("x@y.com", "OLD");
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.match(expired.reason, /expired/);
});

test("gates: allowlist wins over invite code", async () => {
  await setup();
  await EmailAllowlist.create({ email: "ada@example.com" });
  await InviteCode.create({ code: "ALPHA", max_uses: 1, uses: 0, expires_at: null });

  const gate = await canRegister("ada@example.com", "ALPHA");
  assert.deepEqual(gate, { ok: true, via: "allowlist" });
});
