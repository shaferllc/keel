/**
 * Health checks — the two endpoints an orchestrator (Kubernetes, Fly, Railway,
 * a load balancer) asks about before it sends you traffic:
 *
 *   /health/live   is the process up?          — answers instantly, checks nothing
 *   /health/ready  can it serve requests?      — runs every registered check
 *
 * A liveness probe that touched the database would restart a healthy app during a
 * database blip, so it deliberately checks nothing. Readiness is where the checks
 * live: it reports 200 while everything it depends on is reachable, and 503 when
 * something isn't — which pulls the instance out of the pool without killing it.
 *
 *   health().register([new DatabaseCheck(), new RedisCheck()]);
 *   this.use(healthCheck());                    // serves both endpoints
 *
 * Keel ships the checks that mean something wherever it runs — a database, Redis,
 * the cache. Deliberately absent are AdonisJS's disk-space and heap/RSS checks:
 * they measure a Node process, and on Workers there isn't one.
 */

import type { MiddlewareHandler } from "hono";

import { connection } from "./database.js";
import { redis } from "./redis.js";
import { cache } from "./helpers.js";

/* --------------------------------- results -------------------------------- */

export type HealthStatus = "ok" | "warning" | "error";

/** The outcome of a single check. Build one with `Result.ok/warning/failed`. */
export class Result {
  private constructor(
    readonly status: HealthStatus,
    readonly message: string,
    readonly error?: unknown,
    public meta?: Record<string, unknown>,
  ) {}

  /** Healthy. */
  static ok(message: string): Result {
    return new Result("ok", message);
  }

  /**
   * Working, but degraded — worth paging someone, not worth pulling the instance
   * out of the pool. A warning keeps readiness at 200.
   */
  static warning(message: string): Result {
    return new Result("warning", message);
  }

  /** Broken. Any failed check takes readiness to 503. */
  static failed(message: string, error?: unknown): Result {
    return new Result("error", message, error);
  }

  /** Attach arbitrary detail — connection counts, latencies, versions. */
  withMeta(meta: Record<string, unknown>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }
}

/* --------------------------------- checks --------------------------------- */

/** One thing worth knowing about before serving traffic. */
export abstract class BaseCheck {
  abstract readonly name: string;

  private ttl = 0;
  private cached?: { result: Result; expiresAt: number };

  abstract run(): Promise<Result>;

  /**
   * Reuse this check's last result for `seconds`, so a probe every few seconds
   * doesn't hammer the thing it's checking. The report marks a reused result
   * with `isCached: true`.
   */
  cacheFor(seconds: number): this {
    this.ttl = seconds;
    return this;
  }

  /**
   * Run the check, honouring `cacheFor`, and never throw: a check that blows up
   * is itself a failure, and one broken check must not take down the report.
   *
   * @internal — called by `HealthChecks.run()`.
   */
  async execute(): Promise<{ result: Result; isCached: boolean }> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return { result: this.cached.result, isCached: true };
    }

    let result: Result;
    try {
      result = await this.run();
    } catch (error) {
      result = Result.failed(
        error instanceof Error ? error.message : `The "${this.name}" check threw.`,
        error,
      );
    }

    if (this.ttl > 0) {
      this.cached = { result, expiresAt: now + this.ttl * 1000 };
    }
    return { result, isCached: false };
  }
}

/**
 * A check from a plain function — the escape hatch, for anything Keel doesn't
 * ship a check for.
 *
 *   health().register([
 *     check("stripe", async () => {
 *       const res = await fetch("https://api.stripe.com/healthcheck");
 *       return res.ok ? Result.ok("Stripe is reachable") : Result.failed("Stripe is down");
 *     }),
 *   ]);
 */
export function check(name: string, run: () => Promise<Result> | Result): BaseCheck {
  return new (class extends BaseCheck {
    readonly name = name;
    async run(): Promise<Result> {
      return run();
    }
  })();
}

/** Is the database reachable? Runs `SELECT 1` on a connection. */
export class DatabaseCheck extends BaseCheck {
  readonly name: string;

  constructor(private connectionName?: string) {
    super();
    this.name = connectionName ? `database (${connectionName})` : "database";
  }

  async run(): Promise<Result> {
    const started = Date.now();
    await connection(this.connectionName).select("SELECT 1");
    return Result.ok("Database is reachable").withMeta({ durationMs: Date.now() - started });
  }
}

/** Is Redis reachable? Reads a key — a failed read means a broken connection. */
export class RedisCheck extends BaseCheck {
  readonly name = "redis";

  async run(): Promise<Result> {
    const started = Date.now();
    await redis().get("keel:health");
    return Result.ok("Redis is reachable").withMeta({ durationMs: Date.now() - started });
  }
}

/** Does the cache round-trip? Writes a key, reads it back, deletes it. */
export class CacheCheck extends BaseCheck {
  readonly name = "cache";

  async run(): Promise<Result> {
    const started = Date.now();
    const key = "keel:health";
    const store = cache();

    await store.put(key, "ok", 10);
    const value = await store.get<string>(key);
    await store.forget(key);

    if (value !== "ok") {
      return Result.failed("The cache did not return the value just written to it.");
    }
    return Result.ok("Cache is reachable").withMeta({ durationMs: Date.now() - started });
  }
}

/* --------------------------------- report --------------------------------- */

export interface CheckReport {
  name: string;
  status: HealthStatus;
  message: string;
  /** Whether this result was reused from a `cacheFor()` window. */
  isCached: boolean;
  finishedAt: string;
  meta?: Record<string, unknown>;
}

export interface HealthReport {
  /** True unless a check failed. A warning is still healthy. */
  isHealthy: boolean;
  /** The worst status any check reported. */
  status: HealthStatus;
  finishedAt: string;
  checks: CheckReport[];
}

/* ------------------------------- the registry ------------------------------ */

export class HealthChecks {
  private checks: BaseCheck[] = [];

  /** Add checks. Call it once, in a provider's `boot()`. */
  register(checks: BaseCheck[]): this {
    this.checks.push(...checks);
    return this;
  }

  /** Every registered check. */
  all(): BaseCheck[] {
    return [...this.checks];
  }

  clear(): this {
    this.checks = [];
    return this;
  }

  /** Run every check — concurrently, since they're independent I/O. */
  async run(): Promise<HealthReport> {
    const results = await Promise.all(
      this.checks.map(async (c) => {
        const { result, isCached } = await c.execute();
        return {
          name: c.name,
          status: result.status,
          message: result.message,
          isCached,
          finishedAt: new Date().toISOString(),
          ...(result.meta ? { meta: result.meta } : {}),
        } satisfies CheckReport;
      }),
    );

    const status: HealthStatus = results.some((r) => r.status === "error")
      ? "error"
      : results.some((r) => r.status === "warning")
        ? "warning"
        : "ok";

    return {
      isHealthy: status !== "error",
      status,
      finishedAt: new Date().toISOString(),
      checks: results,
    };
  }
}

const registry = new HealthChecks();

/** The application's health-check registry. */
export function health(): HealthChecks {
  return registry;
}

/* ------------------------------- the endpoints ----------------------------- */

export interface HealthCheckOptions {
  /** URL prefix for the two endpoints. Default: `"/health"`. */
  basePath?: string;
  /**
   * Require `Authorization: Bearer <secret>` on the readiness endpoint. The
   * report names your infrastructure, so don't publish it — set this whenever
   * the endpoint is reachable from outside your network.
   */
  secret?: string;
  /** The registry to run. Defaults to the global one from `health()`. */
  checks?: HealthChecks;
}

/**
 * Serve `/health/live` and `/health/ready`. Anything else falls through to your
 * routes.
 *
 *   this.use(healthCheck());
 *   this.use(healthCheck({ secret: env.HEALTH_SECRET }));
 */
export function healthCheck(options: HealthCheckOptions = {}): MiddlewareHandler {
  const basePath = (options.basePath ?? "/health").replace(/\/+$/, "");

  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();

    const { pathname } = new URL(c.req.url);

    // Liveness: the process answered, which is the whole question. Checking a
    // dependency here would get a healthy app restarted during a database blip.
    if (pathname === `${basePath}/live`) {
      return c.json({ isHealthy: true, status: "ok" satisfies HealthStatus });
    }

    if (pathname !== `${basePath}/ready`) return next();

    if (options.secret && c.req.header("Authorization") !== `Bearer ${options.secret}`) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    const report = await (options.checks ?? registry).run();
    return c.json(report, report.isHealthy ? 200 : 503);
  };
}
