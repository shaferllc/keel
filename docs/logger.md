# Logger

A small leveled logger. It writes **structured JSON** by default — one line per
event, ready for log aggregators — and pretty single-line output in debug. Reach
it with the global `logger()` helper.

## Logging

```ts
import { logger } from "@shaferllc/keel/core";

logger().info("user registered", { userId: user.id });
logger().warn("cache miss", { key });
logger().error("payment failed", { orderId, error: String(err) });
logger().debug("query", { sql, ms });
```

The second argument is structured context — it's merged into the log line, not
string-concatenated, so it stays queryable:

```json
{"level":"info","time":"2026-07-10T…","msg":"user registered","userId":42}
```

## Levels

`debug` < `info` < `warn` < `error`. Only events at or above the configured
level are emitted. Set the threshold via config:

```ts
// config/logger.ts
export default { level: env("LOG_LEVEL", "info") };
```

Pretty output turns on automatically when `app.debug` is true.

## Child loggers

Bind fields once (a request id, a job name) and they appear on every line:

```ts
const log = logger().child({ requestId: request.header("x-request-id") });
log.info("handling");   // includes requestId
log.info("done");        // includes requestId
```

## A request-logging middleware

```ts
export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  await next();
  logger().info("request", {
    method: request.method,
    path: request.path,
    status: request.status,
    ms: +(performance.now() - start).toFixed(1),
  });
};
```
