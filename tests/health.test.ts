import { test } from "node:test";
import assert from "node:assert/strict";

import {
  health,
  healthCheck,
  check,
  Result,
  BaseCheck,
  HealthChecks,
  CacheCheck,
  DatabaseCheck,
  type HealthReport,
} from "../src/core/health.js";
import { Application } from "../src/core/application.js";

/** Run a Hono middleware against a URL; the "next" handler returns the text "next". */
async function runMiddleware(
  handler: ReturnType<typeof healthCheck>,
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const { Hono } = await import("hono");
  const app = new Hono();
  app.use("*", handler);
  app.all("*", (c) => c.text("next"));
  return app.request(new Request(url, { headers }));
}

/* --------------------------------- results -------------------------------- */

test("Result carries a status, a message, and optional metadata", () => {
  assert.equal(Result.ok("fine").status, "ok");
  assert.equal(Result.warning("slow").status, "warning");
  assert.equal(Result.failed("down").status, "error");

  const withMeta = Result.ok("fine").withMeta({ durationMs: 5 }).withMeta({ region: "iad" });
  assert.deepEqual(withMeta.meta, { durationMs: 5, region: "iad" });

  const err = new Error("nope");
  assert.equal(Result.failed("down", err).error, err);
});

/* --------------------------------- running -------------------------------- */

test("run() reports every check, and is healthy when they all pass", async () => {
  const checks = new HealthChecks().register([
    check("a", () => Result.ok("a is fine")),
    check("b", async () => Result.ok("b is fine")),
  ]);

  const report = await checks.run();
  assert.equal(report.isHealthy, true);
  assert.equal(report.status, "ok");
  assert.equal(report.checks.length, 2);
  assert.deepEqual(
    report.checks.map((c) => c.name),
    ["a", "b"],
  );
  assert.equal(report.checks[0]?.message, "a is fine");
  assert.ok(Date.parse(report.finishedAt) > 0);
});

test("a warning is still healthy; a failure is not", async () => {
  const warned = await new HealthChecks()
    .register([check("a", () => Result.ok("fine")), check("b", () => Result.warning("slow"))])
    .run();
  assert.equal(warned.status, "warning");
  assert.equal(warned.isHealthy, true); // degraded, but still serving

  const failed = await new HealthChecks()
    .register([check("a", () => Result.warning("slow")), check("b", () => Result.failed("down"))])
    .run();
  assert.equal(failed.status, "error");
  assert.equal(failed.isHealthy, false);
});

test("a check that throws becomes a failure instead of taking down the report", async () => {
  const report = await new HealthChecks()
    .register([
      check("boom", () => {
        throw new Error("connection refused");
      }),
      check("fine", () => Result.ok("fine")),
    ])
    .run();

  assert.equal(report.isHealthy, false);
  assert.equal(report.checks[0]?.status, "error");
  assert.equal(report.checks[0]?.message, "connection refused");
  // The other check still ran and reported.
  assert.equal(report.checks[1]?.status, "ok");
});

test("an empty registry is healthy", async () => {
  const report = await new HealthChecks().run();
  assert.equal(report.isHealthy, true);
  assert.equal(report.status, "ok");
  assert.deepEqual(report.checks, []);
});

test("metadata rides along into the report", async () => {
  const report = await new HealthChecks()
    .register([check("a", () => Result.ok("fine").withMeta({ durationMs: 3 }))])
    .run();
  assert.deepEqual(report.checks[0]?.meta, { durationMs: 3 });
});

/* --------------------------------- caching -------------------------------- */

test("cacheFor reuses the last result and marks it cached", async () => {
  let runs = 0;
  const c = check("counted", () => {
    runs++;
    return Result.ok(`run ${runs}`);
  }).cacheFor(60);

  const checks = new HealthChecks().register([c]);

  const first = await checks.run();
  assert.equal(first.checks[0]?.isCached, false);
  assert.equal(first.checks[0]?.message, "run 1");

  const second = await checks.run();
  assert.equal(second.checks[0]?.isCached, true);
  assert.equal(second.checks[0]?.message, "run 1"); // the same result, not re-run
  assert.equal(runs, 1);
});

test("without cacheFor, every run re-runs the check", async () => {
  let runs = 0;
  const checks = new HealthChecks().register([
    check("counted", () => {
      runs++;
      return Result.ok("fine");
    }),
  ]);

  await checks.run();
  await checks.run();
  assert.equal(runs, 2);
});

test("an expired cache window re-runs the check", async () => {
  let runs = 0;
  // A zero-second window never caches; use a negative TTL to simulate an
  // already-expired one via a custom check.
  class Expiring extends BaseCheck {
    readonly name = "expiring";
    async run(): Promise<Result> {
      runs++;
      return Result.ok(`run ${runs}`);
    }
  }
  const c = new Expiring().cacheFor(0); // 0 → caching disabled
  const checks = new HealthChecks().register([c]);

  await checks.run();
  const second = await checks.run();
  assert.equal(runs, 2);
  assert.equal(second.checks[0]?.isCached, false);
});

/* -------------------------------- registry -------------------------------- */

test("the global health() registry is a singleton, and clear() empties it", async () => {
  assert.equal(health(), health());

  health().register([check("x", () => Result.ok("fine"))]);
  assert.equal(health().all().length, 1);

  health().clear();
  assert.equal(health().all().length, 0);
});

/* -------------------------------- endpoints ------------------------------- */

test("/health/live answers 200 without running any check", async () => {
  let ran = false;
  const checks = new HealthChecks().register([
    check("never", () => {
      ran = true;
      return Result.failed("down");
    }),
  ]);

  const res = await runMiddleware(healthCheck({ checks }), "http://app.test/health/live");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { isHealthy: true, status: "ok" });
  assert.equal(ran, false); // liveness must not touch dependencies
});

test("/health/ready is 200 when healthy and 503 when a check fails", async () => {
  const healthy = new HealthChecks().register([check("a", () => Result.ok("fine"))]);
  const ok = await runMiddleware(healthCheck({ checks: healthy }), "http://app.test/health/ready");
  assert.equal(ok.status, 200);
  const okReport = (await ok.json()) as HealthReport;
  assert.equal(okReport.isHealthy, true);
  assert.equal(okReport.checks[0]?.name, "a");

  const broken = new HealthChecks().register([check("a", () => Result.failed("db is down"))]);
  const bad = await runMiddleware(healthCheck({ checks: broken }), "http://app.test/health/ready");
  assert.equal(bad.status, 503);
  const badReport = (await bad.json()) as HealthReport;
  assert.equal(badReport.isHealthy, false);
  assert.equal(badReport.checks[0]?.message, "db is down");
});

test("a warning keeps readiness at 200", async () => {
  const checks = new HealthChecks().register([check("a", () => Result.warning("slow"))]);
  const res = await runMiddleware(healthCheck({ checks }), "http://app.test/health/ready");
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as HealthReport).status, "warning");
});

test("a secret guards readiness but not liveness", async () => {
  const checks = new HealthChecks().register([check("a", () => Result.ok("fine"))]);
  const handler = healthCheck({ checks, secret: "s3cret" });

  const noAuth = await runMiddleware(handler, "http://app.test/health/ready");
  assert.equal(noAuth.status, 401);

  const wrong = await runMiddleware(handler, "http://app.test/health/ready", {
    Authorization: "Bearer nope",
  });
  assert.equal(wrong.status, 401);

  const right = await runMiddleware(handler, "http://app.test/health/ready", {
    Authorization: "Bearer s3cret",
  });
  assert.equal(right.status, 200);

  // Liveness stays open — the orchestrator's restart probe shouldn't need a key.
  const live = await runMiddleware(handler, "http://app.test/health/live");
  assert.equal(live.status, 200);
});

test("other paths fall through to the app's routes", async () => {
  const res = await runMiddleware(healthCheck(), "http://app.test/api/users");
  assert.equal(await res.text(), "next");
});

test("basePath is configurable", async () => {
  const checks = new HealthChecks().register([check("a", () => Result.ok("fine"))]);
  const handler = healthCheck({ checks, basePath: "/_internal" });

  const res = await runMiddleware(handler, "http://app.test/_internal/ready");
  assert.equal(res.status, 200);

  const old = await runMiddleware(handler, "http://app.test/health/ready");
  assert.equal(await old.text(), "next");
});

/* ------------------------------ built-in checks --------------------------- */

test("CacheCheck round-trips through the application cache", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });

  const report = await new HealthChecks().register([new CacheCheck()]).run();
  assert.equal(report.isHealthy, true);
  assert.equal(report.checks[0]?.name, "cache");
  assert.equal(report.checks[0]?.status, "ok");
});

test("DatabaseCheck reports a failure when no connection is registered", async () => {
  // No database configured — the check must degrade to a failed result, not throw.
  const report = await new HealthChecks().register([new DatabaseCheck()]).run();
  assert.equal(report.isHealthy, false);
  assert.equal(report.checks[0]?.status, "error");
});

test("a named DatabaseCheck says which connection it is", () => {
  assert.equal(new DatabaseCheck().name, "database");
  assert.equal(new DatabaseCheck("reporting").name, "database (reporting)");
});
