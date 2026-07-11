import { test } from "node:test";
import assert from "node:assert/strict";

import { Logger } from "../src/core/logger.js";
import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import { json } from "../src/core/request.js";
import { requestLogger, requestLog } from "../src/core/request-logger.js";

// Capture console.log lines during `fn`.
async function capture(fn: () => Promise<void> | void): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test("redact hides top-level keys and dot paths", async () => {
  const log = new Logger({ redact: ["password", "req.headers.authorization"] });
  const lines = await capture(() => {
    log.info("login", {
      user: "ada",
      password: "s3cret",
      req: { headers: { authorization: "Bearer xyz", accept: "json" } },
    });
  });
  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.user, "ada");
  assert.equal(entry.password, "[redacted]");
  assert.equal(entry.req.headers.authorization, "[redacted]");
  assert.equal(entry.req.headers.accept, "json"); // siblings untouched
});

test("redact does not mutate the caller's object", async () => {
  const log = new Logger({ redact: ["token"] });
  const ctx = { token: "keep-me" };
  await capture(() => log.info("x", ctx));
  assert.equal(ctx.token, "keep-me"); // original object unchanged
});

test("requestLogger attaches a reqId that every requestLog() line carries", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/", () => {
    requestLog().info("handling");
    return json({ ok: true });
  });
  const kernel = new HttpKernel(app);
  kernel.use(requestLogger());
  const hono = kernel.build();

  const lines = await capture(async () => {
    await hono.request("/");
  });
  const entries = lines.map((l) => JSON.parse(l));
  const msgs = entries.map((e) => e.msg);
  assert.ok(msgs.includes("request"));
  assert.ok(msgs.includes("handling"));
  assert.ok(msgs.includes("request completed"));
  // all three share one reqId
  const ids = new Set(entries.map((e) => e.reqId));
  assert.equal(ids.size, 1);
  assert.ok([...ids][0]); // a non-empty id
});

test("request start/completion carry method, path, status, duration", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/x", () => json({ ok: true }));
  const kernel = new HttpKernel(app);
  kernel.use(requestLogger());
  const hono = kernel.build();

  const lines = await capture(async () => {
    await hono.request("/x");
  });
  const entries = lines.map((l) => JSON.parse(l));
  const start = entries.find((e) => e.msg === "request");
  const done = entries.find((e) => e.msg === "request completed");
  assert.equal(start.method, "GET");
  assert.equal(start.path, "/x");
  assert.equal(done.status, 200);
  assert.equal(typeof done.ms, "number");
});

test("idHeader reuses an incoming request id", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/", () => json({ id: 1 }));
  const kernel = new HttpKernel(app);
  kernel.use(requestLogger({ idHeader: "x-request-id" }));
  const hono = kernel.build();

  const lines = await capture(async () => {
    await hono.request("/", { headers: { "x-request-id": "trace-123" } });
  });
  assert.ok(lines.every((l) => JSON.parse(l).reqId === "trace-123"));
});

test("logRequests: false suppresses the auto request lines", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  app.make(Router).get("/", () => {
    requestLog().info("only this");
    return json({ ok: true });
  });
  const kernel = new HttpKernel(app);
  kernel.use(requestLogger({ logRequests: false }));
  const hono = kernel.build();

  const lines = await capture(async () => {
    await hono.request("/");
  });
  const msgs = lines.map((l) => JSON.parse(l).msg);
  assert.deepEqual(msgs, ["only this"]);
});

test("requestLog() falls back to the base logger outside a request", () => {
  assert.ok(requestLog() instanceof Logger); // no throw, returns a logger
});
