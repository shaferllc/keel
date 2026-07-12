import { test } from "node:test";
import assert from "node:assert/strict";

import { Logger, MemorySink, setLogger, namedLogger } from "../src/core/logger.js";
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

/* --------------------------------- levels --------------------------------- */

test("trace and fatal sit at the ends of the level range", () => {
  const sink = new MemorySink();
  const log = new Logger({ level: "trace", sink: sink.sink });

  log.trace("t");
  log.debug("d");
  log.info("i");
  log.warn("w");
  log.error("e");
  log.fatal("f");

  assert.deepEqual(sink.messages(), ["t", "d", "i", "w", "e", "f"]);
});

test("the threshold silences quieter levels", () => {
  const sink = new MemorySink();
  const log = new Logger({ level: "warn", sink: sink.sink });

  log.trace("t");
  log.debug("d");
  log.info("i");
  log.warn("w");
  log.fatal("f");

  assert.deepEqual(sink.messages(), ["w", "f"]);
});

test("isLevelEnabled / ifLevelEnabled gate expensive work", () => {
  const sink = new MemorySink();
  const log = new Logger({ level: "info", sink: sink.sink });

  assert.equal(log.isLevelEnabled("debug"), false);
  assert.equal(log.isLevelEnabled("info"), true);
  assert.equal(log.isLevelEnabled("fatal"), true);

  let built = 0;
  log.ifLevelEnabled("debug", (l) => {
    built++;
    l.debug("expensive");
  });
  assert.equal(built, 0, "the callback must not run below the threshold");

  log.ifLevelEnabled("error", (l) => {
    built++;
    l.error("cheap");
  });
  assert.equal(built, 1);
  assert.deepEqual(sink.messages(), ["cheap"]);
});

test("enabled: false silences the logger at every level", () => {
  const sink = new MemorySink();
  const log = new Logger({ level: "trace", enabled: false, sink: sink.sink });

  log.trace("t");
  log.fatal("f");

  assert.deepEqual(sink.records, []);
  assert.equal(log.isLevelEnabled("fatal"), false);
});

test("log() takes the level at runtime", () => {
  const sink = new MemorySink();
  const log = new Logger({ level: "trace", sink: sink.sink });

  log.log("warn", "dynamic");
  assert.equal(sink.records[0]?.level, "warn");
});

/* --------------------------------- sinks ---------------------------------- */

test("a sink receives the structured record, not a formatted string", () => {
  const sink = new MemorySink();
  const log = new Logger({ sink: sink.sink, bindings: { app: "keel" } });

  log.info("hello", { userId: 1 });

  const record = sink.records[0]!;
  assert.equal(record.level, "info");
  assert.equal(record.msg, "hello");
  assert.deepEqual(record.fields, { app: "keel", userId: 1 });
  assert.ok(Date.parse(record.time) > 0);
});

test("MemorySink helpers: at(), messages(), clear()", () => {
  const sink = new MemorySink();
  const log = new Logger({ level: "trace", sink: sink.sink });

  log.info("one");
  log.error("two");
  log.info("three");

  assert.deepEqual(sink.messages(), ["one", "two", "three"]);
  assert.deepEqual(
    sink.at("info").map((r) => r.msg),
    ["one", "three"],
  );

  sink.clear();
  assert.deepEqual(sink.records, []);
});

/* ------------------------------- redaction -------------------------------- */

test("redaction censors a top-level key and a dot path", () => {
  const sink = new MemorySink();
  const log = new Logger({
    sink: sink.sink,
    redact: ["password", "req.headers.authorization"],
  });

  log.info("login", {
    password: "hunter2",
    email: "a@b.com",
    req: { headers: { authorization: "Bearer xyz", accept: "*/*" } },
  });

  const fields = sink.records[0]!.fields as {
    password: string;
    email: string;
    req: { headers: { authorization: string; accept: string } };
  };
  assert.equal(fields.password, "[redacted]");
  assert.equal(fields.req.headers.authorization, "[redacted]");
  // Everything else is untouched.
  assert.equal(fields.email, "a@b.com");
  assert.equal(fields.req.headers.accept, "*/*");
});

test("a wildcard segment redacts every key at that level", () => {
  const sink = new MemorySink();
  const log = new Logger({ sink: sink.sink, redact: ["*.password", "creds.*.token"] });

  log.info("audit", {
    alice: { password: "a", name: "Alice" },
    bob: { password: "b", name: "Bob" },
    creds: { aws: { token: "t1" }, gcp: { token: "t2" } },
  });

  const fields = sink.records[0]!.fields as Record<string, Record<string, unknown>>;
  assert.equal(fields.alice!.password, "[redacted]");
  assert.equal(fields.bob!.password, "[redacted]");
  assert.equal(fields.alice!.name, "Alice"); // untouched
  assert.equal((fields.creds!.aws as Record<string, unknown>).token, "[redacted]");
  assert.equal((fields.creds!.gcp as Record<string, unknown>).token, "[redacted]");
});

test("redact accepts a custom censor, or removes the key outright", () => {
  const censored = new MemorySink();
  new Logger({ sink: censored.sink, redact: { paths: ["password"], censor: "***" } }).info("x", {
    password: "hunter2",
  });
  assert.equal((censored.records[0]!.fields as { password: string }).password, "***");

  const removed = new MemorySink();
  new Logger({ sink: removed.sink, redact: { paths: ["password"], remove: true } }).info("x", {
    password: "hunter2",
    email: "a@b.com",
  });
  assert.deepEqual(removed.records[0]!.fields, { email: "a@b.com" });
});

test("redaction does not mutate the caller's object", () => {
  const sink = new MemorySink();
  const log = new Logger({ sink: sink.sink, redact: ["req.headers.authorization"] });

  const context = { req: { headers: { authorization: "Bearer xyz" } } };
  log.info("x", context);

  assert.equal(context.req.headers.authorization, "Bearer xyz", "the caller's object must survive");
});

test("a redact path that matches nothing is a no-op", () => {
  const sink = new MemorySink();
  new Logger({ sink: sink.sink, redact: ["nope", "a.b.c"] }).info("x", { email: "a@b.com" });
  assert.deepEqual(sink.records[0]!.fields, { email: "a@b.com" });
});

/* --------------------------------- child ---------------------------------- */

test("a child inherits the sink, level, and redaction, and adds bindings", () => {
  const sink = new MemorySink();
  const parent = new Logger({ level: "debug", sink: sink.sink, redact: ["password"], bindings: { app: "keel" } });

  const child = parent.child({ reqId: "abc" });
  child.debug("handled", { password: "hunter2" });

  const record = sink.records[0]!;
  assert.deepEqual(record.fields, { app: "keel", reqId: "abc", password: "[redacted]" });
});

/* ------------------------------ named loggers ----------------------------- */

test("named loggers get their own level and destination", () => {
  const audit = new MemorySink();
  setLogger(new Logger({ level: "trace", sink: audit.sink }), "audit");

  namedLogger("audit").trace("permission granted", { userId: 1 });

  assert.deepEqual(audit.messages(), ["permission granted"]);
});

test("namedLogger throws for an unknown name", () => {
  assert.throws(() => namedLogger("nope"), /No logger named "nope"/);
});
