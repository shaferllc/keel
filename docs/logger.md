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

Every line carries three reserved keys — `level`, `time` (an ISO-8601 stamp), and
`msg` — followed by any bound fields and then the call's `context`. Context is
spread last, so a context key of `level`, `time`, or `msg` overwrites the reserved
field; steer clear of those names in your payloads.

## Levels

`debug` < `info` < `warn` < `error`. Only events at or above the configured
level are emitted. Set the threshold via config:

```ts
// config/logger.ts
export default { level: env("LOG_LEVEL", "info") };
```

Under the hood the levels are ordinal (`debug` 10, `info` 20, `warn` 30,
`error` 40); a line is dropped when its level sits below the threshold. The
default threshold is `"info"`, so `debug` lines stay silent until you lower it.

Pretty output turns on automatically when `app.debug` is true. In pretty mode
each event is a single human-readable line —
`[2026-07-10T…] INFO  user registered {"userId":42}` — and the writer routes by
level: `warn` goes to `console.warn`, `error` to `console.error`, everything else
to `console.log`. In JSON mode every level is written to `console.log`.

## Child loggers

Bind fields once (a request id, a job name) and they appear on every line:

```ts
const log = logger().child({ requestId: request.header("x-request-id") });
log.info("handling");   // includes requestId
log.info("done");        // includes requestId
```

A child inherits its parent's `level` and `pretty` settings and *merges* its
bindings on top of the parent's — so you can nest them, and a child's field wins
over a parent's field of the same name. The parent is untouched; `child()`
returns a fresh `Logger`.

```ts
const base = logger().child({ service: "billing" });
const job = base.child({ jobId });   // { service, jobId } on every line
```

## Standing up a logger yourself

The framework binds one `Logger` for you, but the class is a plain object you can
construct directly — handy in a script or a test:

```ts
import { Logger } from "@shaferllc/keel/core";

const log = new Logger({ level: "debug", pretty: true, bindings: { env: "dev" } });
log.debug("boot", { pid: 1 });
```

With no options it defaults to `level: "info"`, `pretty: false`, and no bindings.

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

---

## API reference

### `logger()`

`logger(): Logger`

Resolves the application's shared `Logger` from the container.

```ts
import { logger } from "@shaferllc/keel/core";

logger().info("ready");
```

**Notes:** a global helper — no need to thread the logger through your call stack.
Throws `No Keel application has been bootstrapped…` if called before an
`Application` exists. Returns the same singleton every call, so `child()` off it
when you want per-request bindings rather than mutating the shared instance.

### `Logger`

The logger itself. The framework binds one for you (reach it with `logger()`),
but you can also `new Logger(options)` directly.

#### `new Logger(options?)`

`new Logger(options?: LoggerOptions): Logger`

Creates a logger with the given level, format, and bound fields.

```ts
const log = new Logger({ level: "warn", pretty: true });
```

**Notes:** `options` defaults to `{}`, which resolves to `level: "info"`,
`pretty: false`, no bindings. The level is captured at construction — there is no
setter, so change it by creating a new logger.

#### `debug(message, context?)`

`debug(message: string, context?: Record<string, unknown>): void`

Logs at the `debug` level — the noisiest, off by default.

```ts
log.debug("cache lookup", { key });
```

**Notes:** suppressed unless the threshold is `"debug"`. `context` is optional and
merged into the line after the bound fields.

#### `info(message, context?)`

`info(message: string, context?: Record<string, unknown>): void`

Logs at the `info` level — the default threshold.

```ts
log.info("user registered", { userId: 42 });
```

#### `warn(message, context?)`

`warn(message: string, context?: Record<string, unknown>): void`

Logs at the `warn` level.

```ts
log.warn("cache miss", { key });
```

**Notes:** in pretty mode this routes to `console.warn`; in JSON mode, like every
level, to `console.log`.

#### `error(message, context?)`

`error(message: string, context?: Record<string, unknown>): void`

Logs at the `error` level — the highest, always emitted.

```ts
log.error("payment failed", { orderId, error: String(err) });
```

**Notes:** in pretty mode this routes to `console.error`. It does not throw or
capture stack traces for you — serialize an `Error` into `context` yourself
(e.g. `error: String(err)` or `err.stack`).

#### `child(bindings)`

`child(bindings: Record<string, unknown>): Logger`

Returns a new logger that carries `bindings` on every line, in addition to the
parent's.

```ts
const reqLog = logger().child({ requestId });
reqLog.info("handling");   // line includes requestId
```

**Notes:** inherits the parent's `level` and `pretty`; merges bindings over the
parent's (child wins on key collisions). Chainable — call `child()` on a child.
The parent is not modified.

### Interfaces & types

#### `LoggerOptions`

```ts
interface LoggerOptions {
  level?: LogLevel;                     // minimum level to emit; default "info"
  pretty?: boolean;                     // single-line human output; default false
  bindings?: Record<string, unknown>;   // fields merged into every line
}
```

Passed to `new Logger()` (and carried forward by `child()`). Use it to set the
threshold, switch to pretty output, and attach ambient fields.

```ts
const log = new Logger({ level: "debug", pretty: true, bindings: { app: "api" } });
```

#### `LogLevel`

`type LogLevel = "debug" | "info" | "warn" | "error"`

The four severity levels, in ascending order. Used for the `level` option and
selected implicitly by each method.

```ts
const threshold: LogLevel = "warn";
new Logger({ level: threshold });
```
