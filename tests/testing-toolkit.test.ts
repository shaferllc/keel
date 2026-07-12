import { test } from "node:test";
import assert from "node:assert/strict";

import {
  testClient,
  freezeTime,
  timeTravel,
  restoreTime,
  timeIsFrozen,
  spy,
  spyOn,
  restoreSpies,
  resetState,
  truncate,
  assertDatabaseHas,
  assertDatabaseMissing,
  assertDatabaseCount,
  assertDatabaseEmpty,
  runCommand,
} from "../src/core/testing.js";
import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { validate } from "../src/core/validation.js";
import { setConnection, type Connection } from "../src/core/database.js";
import { CommandResult } from "../src/core/testing.js";

/* ----------------------------- the test client ---------------------------- */

async function appWithRoutes(): Promise<HttpKernel> {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: { key: "k" } } });

  const router = app.make(Router);

  router.get("/json", (c) => c.json({ user: { id: 1, email: "a@b.com" }, meta: { page: 1 } }));
  router.get("/html", (c) => c.html("<h1>Hello Ada</h1>"));
  router.get("/echo-headers", (c) =>
    c.json({ auth: c.req.header("authorization") ?? null, cookie: c.req.header("cookie") ?? null }),
  );
  router.get("/cookie", (c) => {
    c.header("set-cookie", "session=abc123; Path=/; HttpOnly");
    return c.text("ok");
  });
  router.post("/form", async (c) => c.json(Object.fromEntries(await c.req.formData())));
  router.get("/missing", (c) => c.json({ error: "nope" }, 404));
  router.post("/users", async (c) => {
    const { z } = await import("zod");
    await validate(z.object({ email: z.string().email(), age: z.number() }), await c.req.json());
    return c.json({ ok: true }, 201);
  });

  return new HttpKernel(app);
}

test("assertJsonContains matches a subset, so unrelated fields don't break the test", async () => {
  const client = testClient(await appWithRoutes());
  const res = await client.get("/json");

  res.assertOk().assertJsonContains({ user: { email: "a@b.com" } });
  res.assertJsonContains({ meta: { page: 1 } });

  assert.throws(() => res.assertJsonContains({ user: { email: "wrong@b.com" } }), /does not contain/);
  assert.throws(() => res.assertJsonContains({ nope: true }), /does not contain/);
});

test("assertSee / assertDontSee look inside the body", async () => {
  const client = testClient(await appWithRoutes());
  const res = await client.get("/html");

  res.assertSee("Hello Ada").assertDontSee("Goodbye");
  assert.throws(() => res.assertSee("Goodbye"), /to contain "Goodbye"/);
  assert.throws(() => res.assertDontSee("Hello"), /not to contain "Hello"/);
});

test("status shorthands", async () => {
  const client = testClient(await appWithRoutes());

  (await client.get("/missing")).assertNotFound();
  (await client.post("/users", { email: "a@b.com", age: 30 })).assertCreated();

  const res = await client.get("/json");
  assert.throws(() => res.assertNotFound(), /Expected status 404, got 200/);
});

test("assertValidationErrors names the fields that failed", async () => {
  const client = testClient(await appWithRoutes());

  const res = await client.post("/users", { email: "not-an-email", age: "old" });
  res.assertUnprocessable().assertValidationErrors("email", "age");
  res.assertNoValidationError("name");

  assert.throws(() => res.assertValidationErrors("nope"), /Expected a validation error on "nope"/);
});

test("withHeaders / withToken / withCookie are sent on the request", async () => {
  const client = testClient(await appWithRoutes());

  const plain = await client.get("/echo-headers");
  plain.assertJsonContains({ auth: null, cookie: null });

  const authed = await client.withToken("tok_123").get("/echo-headers");
  authed.assertJsonContains({ auth: "Bearer tok_123" });

  const withCookie = await client.withCookie("session", "abc").get("/echo-headers");
  withCookie.assertJsonContains({ cookie: "session=abc" });

  // withX returns a *copy*, so the original client is untouched.
  (await client.get("/echo-headers")).assertJsonContains({ auth: null });
});

test("withBasicAuth encodes the credentials", async () => {
  const client = testClient(await appWithRoutes());
  const res = await client.withBasicAuth("ada", "s3cret").get("/echo-headers");
  res.assertJsonContains({ auth: `Basic ${btoa("ada:s3cret")}` });
});

test("assertCookie reads Set-Cookie", async () => {
  const client = testClient(await appWithRoutes());
  const res = await client.get("/cookie");

  res.assertCookie("session").assertCookie("session", "abc123").assertCookieMissing("other");
  assert.throws(() => res.assertCookie("session", "wrong"), /to be "wrong"/);
  assert.throws(() => res.assertCookieMissing("session"), /Expected no "session" cookie/);
});

test("assertHeaderMissing", async () => {
  const client = testClient(await appWithRoutes());
  const res = await client.get("/json");

  res.assertHeaderMissing("x-nope");
  assert.throws(() => res.assertHeaderMissing("content-type"), /Expected no content-type header/);
});

test("form() posts url-encoded fields", async () => {
  const client = testClient(await appWithRoutes());
  const res = await client.form("/form", { email: "a@b.com", age: 30 });
  res.assertJsonContains({ email: "a@b.com", age: "30" });
});

/* ------------------------------ time control ------------------------------ */

test("freezeTime stops the clock", () => {
  assert.equal(timeIsFrozen(), false);

  const at = freezeTime("2026-07-11T12:00:00Z");
  assert.equal(timeIsFrozen(), true);

  assert.equal(Date.now(), at);
  assert.equal(new Date().getTime(), at);
  assert.equal(new Date().toISOString(), "2026-07-11T12:00:00.000Z");

  // It really doesn't move.
  const first = Date.now();
  for (let i = 0; i < 1e5; i++);
  assert.equal(Date.now(), first);

  restoreTime();
  assert.equal(timeIsFrozen(), false);
});

test("timeTravel moves the frozen clock", () => {
  freezeTime("2026-07-11T12:00:00Z");

  timeTravel(3_600_000); // an hour
  assert.equal(new Date().toISOString(), "2026-07-11T13:00:00.000Z");

  timeTravel(-3_600_000); // ...and back
  assert.equal(new Date().toISOString(), "2026-07-11T12:00:00.000Z");

  restoreTime();
});

test("an explicit date still constructs normally while frozen", () => {
  freezeTime("2026-07-11T12:00:00Z");
  // Only the *zero-argument* Date is faked — parsing a real date must still work.
  assert.equal(new Date("2020-01-01T00:00:00Z").toISOString(), "2020-01-01T00:00:00.000Z");
  assert.equal(new Date(0).getTime(), 0);
  restoreTime();
});

test("restoreTime gives the real clock back", () => {
  freezeTime("2000-01-01T00:00:00Z");
  restoreTime();
  assert.ok(Date.now() > new Date("2020-01-01").getTime());
});

/* --------------------------------- spies ---------------------------------- */

test("spy records calls and can be given a return value", () => {
  const send = spy<[string, number], string>();

  assert.equal(send.called, false);
  assert.equal(send.callCount, 0);

  send("hello", 1);
  send("world", 2);

  assert.equal(send.callCount, 2);
  assert.equal(send.called, true);
  assert.deepEqual(send.calls, [
    ["hello", 1],
    ["world", 2],
  ]);
  assert.ok(send.calledWith("hello", 1));
  assert.ok(!send.calledWith("hello", 99));

  send.returns("ok");
  assert.equal(send("x", 3), "ok");

  send.reset();
  assert.equal(send.callCount, 0);
});

test("a spy can wrap an implementation", () => {
  const double = spy((n: number) => n * 2);
  assert.equal(double(21), 42);
  assert.ok(double.calledWith(21));
});

test("spyOn replaces a method and restoreSpies puts it back", () => {
  const service = {
    charge(amount: number): string {
      return `charged ${amount}`;
    },
  };
  const original = service.charge;

  const charge = spyOn(service, "charge");
  // By default it still calls through.
  assert.equal(service.charge(10), "charged 10");
  assert.equal(charge.callCount, 1);
  assert.ok(charge.calledWith(10));

  charge.returns("stubbed");
  assert.equal(service.charge(20), "stubbed");

  restoreSpies();
  assert.equal(service.charge, original);
  assert.equal(service.charge(30), "charged 30");
});

/* --------------------------- database assertions -------------------------- */

/**
 * A tiny in-memory Connection that actually honors `WHERE col = ?`, so the
 * assertions below are exercised for real rather than against canned rows.
 */
function seeded(rows: Record<string, unknown>[]): void {
  let table = [...rows];

  const conn: Connection = {
    async select(sql: string, bindings: unknown[]) {
      const where = /WHERE (.+?)(?: ORDER| LIMIT|$)/i.exec(sql)?.[1];
      if (!where) return [...table];

      const columns = [...where.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]!);
      return table.filter((row) =>
        columns.every((col, i) => String(row[col]) === String(bindings[i])),
      );
    },
    async write(sql: string) {
      if (/^DELETE FROM/i.test(sql)) {
        const removed = table.length;
        table = [];
        return { rowsAffected: removed };
      }
      return { rowsAffected: 0 };
    },
  } as unknown as Connection;

  setConnection(conn, "sqlite");
}

test("assertDatabaseHas / Missing / Count / Empty", async () => {
  seeded([
    { id: 1, email: "a@b.com", active: 1 },
    { id: 2, email: "c@d.com", active: 0 },
  ]);

  await assertDatabaseHas("users", { email: "a@b.com" });
  await assertDatabaseHas("users", { active: 1 }, 1); // exactly one
  await assertDatabaseMissing("users", { email: "nobody@x.com" });
  await assertDatabaseCount("users", 2);

  await assert.rejects(
    () => assertDatabaseHas("users", { email: "nobody@x.com" }),
    /Expected a row in "users".*but found none.*2 row\(s\)/s,
  );
  await assert.rejects(() => assertDatabaseMissing("users", { email: "a@b.com" }), /but found 1/);
  await assert.rejects(() => assertDatabaseCount("users", 5), /to hold 5 row\(s\), found 2/);
  await assert.rejects(() => assertDatabaseHas("users", { active: 1 }, 2), /Expected 2 row\(s\)/);

  await truncate("users");
  await assertDatabaseEmpty("users");
  await assertDatabaseCount("users", 0);
});

/* ------------------------------- state reset ------------------------------ */

test("resetState restores the fakes and unfreezes the clock", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });

  freezeTime("2026-01-01T00:00:00Z");
  assert.equal(timeIsFrozen(), true);

  resetState();

  assert.equal(timeIsFrozen(), false, "the clock is running again");
});

/* ------------------------------ console tests ----------------------------- */

test("runCommand captures stdout, stderr, and the exit code", async () => {
  const result = await runCommand(() => {
    console.log("GET  /users");
    console.warn("POST /users");
    console.error("something went sideways");
  });

  result.assertSucceeded();
  result.assertOutputContains("GET  /users");
  result.assertOutputMatches(/POST\s+\/users/);
  result.assertErrorContains("sideways");
  assert.equal(result.exitCode, 0);
});

test("a command that sets a non-zero exit code has failed", async () => {
  const result = await runCommand(() => {
    console.error("no such file");
    process.exitCode = 2;
  });

  result.assertFailed().assertExitCode(2).assertErrorContains("no such file");
});

test("a command that throws is a failure, not an exploded test", async () => {
  const result = await runCommand(() => {
    throw new Error("boom");
  });

  result.assertFailed().assertErrorContains("boom");
});

test("runCommand restores the console and the exit code afterwards", async () => {
  const before = console.log;
  await runCommand(() => {
    console.log("captured");
    process.exitCode = 1;
  });

  assert.equal(console.log, before, "console.log is restored");
  assert.notEqual(process.exitCode, 1, "the test process's exit code is not left dirty");
});

test("CommandResult assertions report what actually happened", () => {
  const ok = new CommandResult(["GET  /users", "POST /users"], [], 0);

  ok.assertSucceeded().assertExitCode(0).assertOutputContains("GET  /users").assertOutputMatches(/POST/);

  assert.throws(() => ok.assertFailed(), /Expected the command to fail/);
  assert.throws(() => ok.assertExitCode(1), /Expected exit code 1, got 0/);
  assert.throws(() => ok.assertOutputContains("nope"), /Expected the output to contain "nope"/);

  const bad = new CommandResult([], ["boom"], 1);
  bad.assertFailed().assertErrorContains("boom");
  assert.throws(() => bad.assertSucceeded(), /Expected exit code 0, got 1/);
});
