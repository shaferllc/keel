// Type-check harness for docs/health.md. Compile-only — never executed.
import {
  health,
  healthCheck,
  check,
  Result,
  BaseCheck,
  HealthChecks,
  DatabaseCheck,
  RedisCheck,
  CacheCheck,
  HttpKernel,
  ServiceProvider,
  type HealthReport,
  type CheckReport,
  type HealthStatus,
} from "@shaferllc/keel/core";

declare const env: { HEALTH_SECRET: string };
declare function queue(): { size(): Promise<number> };

export class HealthServiceProvider extends ServiceProvider {
  boot(): void {
    health().register([new DatabaseCheck(), new RedisCheck().cacheFor(30)]);

    this.app.make(HttpKernel).use(healthCheck());
  }
}

export function builtInChecks() {
  health().register([
    new DatabaseCheck(),
    new DatabaseCheck("reporting"),
    new RedisCheck(),
    new CacheCheck(),
  ]);
}

export function functionChecks() {
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
}

export class QueueDepthCheck extends BaseCheck {
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

export function protectedEndpoint() {
  return healthCheck({ secret: env.HEALTH_SECRET });
}

export function customBasePathAndRegistry() {
  const checks = new HealthChecks().register([check("a", () => Result.ok("fine"))]);
  return healthCheck({ basePath: "/_internal", checks });
}

export async function runningByHand(): Promise<{
  report: HealthReport;
  first: CheckReport | undefined;
  status: HealthStatus;
}> {
  const report = await health().run();
  return { report, first: report.checks[0], status: report.status };
}

export function inspectRegistry() {
  const all: BaseCheck[] = health().all();
  health().clear();
  return all;
}
