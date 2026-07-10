import { test } from "node:test";
import assert from "node:assert/strict";

import { Logger } from "../src/core/logger.js";
import { Application } from "../src/core/application.js";
import { logger } from "../src/core/helpers.js";

function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    Object.assign(console, original);
  }
  return lines;
}

test("logger: level threshold and structured JSON", () => {
  const lines = capture(() => {
    const log = new Logger({ level: "info" });
    log.debug("skipped"); // below threshold
    log.info("hello", { a: 1 });
    log.error("boom");
  });
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]!);
  assert.equal(first.level, "info");
  assert.equal(first.msg, "hello");
  assert.equal(first.a, 1);
  assert.ok(first.time);
});

test("logger: child adds bound fields", () => {
  const lines = capture(() => {
    new Logger({ level: "info" }).child({ reqId: "x1" }).info("hi");
  });
  assert.equal(JSON.parse(lines[0]!).reqId, "x1");
});

test("logger: pretty mode formats a single line", () => {
  const lines = capture(() => {
    new Logger({ level: "debug", pretty: true }).warn("careful", { n: 1 });
  });
  assert.match(lines[0]!, /WARN\s+careful/);
});

test("logger() helper resolves the application logger", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  assert.ok(logger() instanceof Logger);
});
