# Health Checks

Two endpoints, answering the two questions an orchestrator — Kubernetes, Fly,
Railway, a load balancer — actually asks:

| Endpoint | Question | Checks |
|----------|----------|--------|
| `/health/live` | Is the process up? | **nothing** — answers instantly |
| `/health/ready` | Can it serve requests? | every registered check |

The split matters. A liveness probe that touched the database would get a
perfectly healthy app **restarted** during a database blip. So liveness checks
nothing: if it answered, the process is alive. Readiness is where dependencies are
checked — a 503 there pulls the instance out of the load-balancer pool without
killing it, and it rejoins when the dependency recovers.

## Using it

Register your checks once, then install the middleware:

```ts
import { health, healthCheck, HttpKernel, DatabaseCheck, RedisCheck } from "@shaferllc/keel/core";

export class HealthServiceProvider extends ServiceProvider {
  boot(): void {
    health().register([
      new DatabaseCheck(),
      new RedisCheck().cacheFor(30),
    ]);

    this.app.make(HttpKernel).use(healthCheck());
  }
}
```

`GET /health/ready` now returns:

```json
{
  "isHealthy": true,
  "status": "ok",
  "finishedAt": "2026-07-11T18:04:22.014Z",
  "checks": [
    {
      "name": "database",
      "status": "ok",
      "message": "Database is reachable",
      "isCached": false,
      "finishedAt": "2026-07-11T18:04:22.011Z",
      "meta": { "durationMs": 3 }
    }
  ]
}
```

with **200** while `isHealthy` is true and **503** the moment a check fails.

## Built-in checks

| Check | What it does |
|-------|--------------|
| `DatabaseCheck` | `SELECT 1` on the default connection, or `new DatabaseCheck("reporting")` for a named one |
| `RedisCheck` | Reads a key — a failed read means a broken connection |
| `CacheCheck` | Writes a key, reads it back, deletes it |

Notably **absent**: AdonisJS's disk-space, heap, and RSS checks. Those measure a
Node process, and on Workers there isn't one — a memory threshold you can't
observe is worse than no check at all. If you're on Node and want them, `check()`
below takes ten lines.

## Your own checks

`check(name, fn)` builds one from a function. Return `Result.ok`, `Result.warning`,
or `Result.failed`:

```ts
import { check, Result, health } from "@shaferllc/keel/core";

health().register([
  check("stripe", async () => {
    const res = await fetch("https://api.stripe.com/healthcheck");
    return res.ok
      ? Result.ok("Stripe is reachable")
      : Result.failed(`Stripe returned ${res.status}`);
  }),

  check("queue-depth", async () => {
    const depth = await queue().size();
    if (depth > 10_000) return Result.failed(`Queue is backed up (${depth})`);
    if (depth > 1_000) return Result.warning(`Queue is deep (${depth})`);
    return Result.ok("Queue is keeping up").withMeta({ depth });
  }),
]);
```

**A warning is still healthy.** It shows up in the report and moves the overall
`status` to `"warning"`, but readiness stays **200** — degraded is not the same as
unable to serve, and you don't want a slow-but-working queue to evict every
instance you have. Only `Result.failed` returns a 503.

`withMeta()` attaches arbitrary detail (latencies, counts, versions) to the check's
entry in the report.

For a check with dependencies or state, extend `BaseCheck` instead:

```ts
class QueueDepthCheck extends BaseCheck {
  readonly name = "queue-depth";

  constructor(private limit = 10_000) {
    super();
  }

  async run(): Promise<Result> {
    const depth = await queue().size();
    return depth > this.limit
      ? Result.failed(`Queue is backed up (${depth})`)
      : Result.ok("Queue is keeping up").withMeta({ depth });
  }
}
```

**A check that throws becomes a failure**, not an exception — one broken check
never takes down the whole report, and the other checks still run and report.

## Caching a check

A probe every few seconds shouldn't hammer the thing it's probing. `cacheFor(seconds)`
reuses the last result inside that window, and the report marks it `isCached: true`:

```ts
health().register([
  new DatabaseCheck(),          // run every time — it's cheap
  new RedisCheck().cacheFor(30), // at most once every 30s
]);
```

## Protecting the endpoint

The readiness report names your infrastructure, so don't publish it. Pass a
`secret` and readiness requires `Authorization: Bearer <secret>`:

```ts
this.app.make(HttpKernel).use(healthCheck({ secret: env.HEALTH_SECRET }));
```

Liveness stays open — the orchestrator's restart probe shouldn't need a key, and
it reveals nothing.

---

## API reference

### `health()`

`health(): HealthChecks`

The application's health-check registry — a singleton.

### `healthCheck(options?)`

`healthCheck(options?: HealthCheckOptions): MiddlewareHandler`

Serves `/health/live` and `/health/ready`. Anything else falls through to your
routes.

**Options:** `basePath` (default `"/health"`), `secret` (bearer token required on
readiness), `checks` (a `HealthChecks` to run instead of the global registry —
handy in tests).

### `HealthChecks`

| Method | Signature |
|--------|-----------|
| `register` | `(checks: BaseCheck[]) => this` |
| `run` | `() => Promise<HealthReport>` — runs every check concurrently |
| `all` | `() => BaseCheck[]` |
| `clear` | `() => this` |

### `check(name, fn)`

`check(name: string, run: () => Promise<Result> | Result): BaseCheck`

Builds a check from a function.

### `BaseCheck`

Abstract. Implement `name` and `run(): Promise<Result>`. `cacheFor(seconds)` reuses
the last result for a window.

### `Result`

`Result.ok(message)` / `Result.warning(message)` / `Result.failed(message, error?)`,
plus `withMeta(data)` to attach detail. A warning keeps readiness at 200; a failure
takes it to 503.

### Interfaces & types

#### `HealthReport`

```ts
{
  isHealthy: boolean;   // false only if a check failed
  status: HealthStatus; // the worst status any check reported
  finishedAt: string;   // ISO 8601
  checks: CheckReport[];
}
```

#### `CheckReport`

```ts
{
  name: string;
  status: HealthStatus;
  message: string;
  isCached: boolean;    // reused from a cacheFor() window
  finishedAt: string;
  meta?: Record<string, unknown>;
}
```

#### `HealthStatus`

`type HealthStatus = "ok" | "warning" | "error"`.
