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

`trace` < `debug` < `info` < `warn` < `error` < `fatal`. Only events at or above
the configured level are emitted. Set the threshold via config:

```ts
// config/logger.ts
export default { level: env("LOG_LEVEL", "info") };
```

Under the hood the levels are ordinal (`trace` 10, `debug` 20, `info` 30, `warn`
40, `error` 50, `fatal` 60); a line is dropped when its level sits below the
threshold. The default threshold is `"info"`, so `debug` and `trace` stay silent
until you lower it.

`log(level, message, context?)` takes the level at runtime, when it isn't known
statically.

Pretty output turns on automatically when `app.debug` is true. In pretty mode
each event is a single human-readable line —
`[2026-07-10T…] INFO  user registered {"userId":42}` — and the writer routes by
level: `warn` goes to `console.warn`, `error` and `fatal` to `console.error`,
everything else to `console.log`. In JSON mode every level is written to
`console.log`.

`enabled: false` silences a logger entirely, at every level.

### Don't pay for lines you won't emit

The threshold drops the *line*, but the **context object is built either way** —
so an expensive snapshot costs you even when nobody sees it. Gate it:

```ts
if (logger().isLevelEnabled("debug")) {
  logger().debug("state", { snapshot: expensiveSnapshot() });
}

// ...or the callback form
logger().ifLevelEnabled("debug", (log) => log.debug("state", { snapshot: expensiveSnapshot() }));
```

## Where the lines go

A **sink** is where log records land. The default writes to the console (JSON, or
pretty), but it's just a function, so logs can go anywhere — a file, an HTTP
collector, a buffer:

```ts
import { Logger, type Sink } from "@shaferllc/keel/core";

const httpSink: Sink = (record) => {
  void fetch("https://logs.example.com", { method: "POST", body: JSON.stringify(record) });
};

new Logger({ sink: httpSink });
```

A sink receives the structured `LogRecord` — `{ level, time, msg, fields }` — not a
formatted string, so it can do what it likes with the shape. `fields` is already
redacted.

`MemorySink` collects records in memory, which is what you want in a test:

```ts
import { Logger, MemorySink } from "@shaferllc/keel/core";

const sink = new MemorySink();
const log = new Logger({ level: "trace", sink: sink.sink });

log.info("hello", { userId: 1 });

sink.messages(); // ["hello"]
sink.at("info"); // the records at one level
sink.records[0].fields; // { userId: 1 }
sink.clear();
```

## Named loggers

Give a subsystem its own level or destination:

```ts
import { setLogger, namedLogger, Logger } from "@shaferllc/keel/core";

setLogger(new Logger({ level: "trace", sink: auditSink }), "audit");

namedLogger("audit").trace("permission granted", { userId });
```

The application's own logger stays where it is — reach that with `logger()`.

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

## Per-request logging

`requestLogger()` is a built-in middleware that binds a **child logger with a
generated `reqId` to each request**, so every log line within a request
correlates — Fastify's `request.log`. Install it in your HTTP kernel, then reach
the request's logger anywhere with `requestLog()`:

```ts
import { requestLogger, requestLog } from "@shaferllc/keel/core";

// app/Http/Kernel.ts
kernel.use(requestLogger());

// anywhere in the request — the line carries this request's reqId:
requestLog().info("charging card", { orderId });
```

By default it also logs the request start and completion:

```json
{"level":"info","time":"…","msg":"request","reqId":"…","method":"GET","path":"/orders"}
{"level":"info","time":"…","msg":"request completed","reqId":"…","status":200,"ms":12.4}
```

Options: `genReqId(c)` to control id generation, `idHeader` to reuse an incoming
id (e.g. `"x-request-id"` for distributed tracing), and `logRequests: false` to
skip the automatic start/completion lines. Outside a request (or without the
middleware), `requestLog()` falls back to the base `logger()`.

## Redaction

Keep secrets out of your logs with `redact` — top-level keys or dot paths. Matched
values are replaced with `"[redacted]"`; **the original object is never mutated**,
so redacting doesn't corrupt the data you're still using:

```ts
const log = new Logger({
  redact: ["password", "req.headers.authorization"],
});

log.info("login", { user: "ada", password: "s3cret", req: { headers: { authorization: "Bearer x" } } });
// {"level":"info",…,"user":"ada","password":"[redacted]","req":{"headers":{"authorization":"[redacted]"}}}
```

A `*` segment matches every key at that level — which is how you catch a secret
that appears under a key you don't know in advance:

```ts
new Logger({ redact: ["*.password", "creds.*.token"] });

log.info("audit", {
  alice: { password: "a", name: "Alice" },
  bob: { password: "b", name: "Bob" },
});
// both passwords redacted; both names kept
```

Pass an object instead of an array to change the placeholder, or drop the key
outright:

```ts
new Logger({ redact: { paths: ["password"], censor: "***" } });
new Logger({ redact: { paths: ["password"], remove: true } }); // the key disappears
```

Redaction is inherited by child loggers, so a redacting base logger keeps
per-request loggers safe too, and it runs **before** the sink — a custom sink can
never see the unredacted values.

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

### `requestLogger(options?)`

`requestLogger(options?: RequestLoggerOptions): MiddlewareHandler`

Middleware that binds a `reqId` child logger to each request and (by default)
logs the request start and completion.

```ts
kernel.use(requestLogger({ idHeader: "x-request-id" }));
```

**Notes:** options — `genReqId(c)` (default `crypto.randomUUID()`), `idHeader`
(reuse an incoming id), `logRequests` (default `true`).

### `requestLog()`

`requestLog(): Logger`

The current request's child logger (carrying its `reqId`), or the base `logger()`
outside a request / without the middleware installed.

```ts
requestLog().info("charging card"); // line carries reqId
```

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

`type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal"`

The four severity levels, in ascending order. Used for the `level` option and
selected implicitly by each method.

```ts
const threshold: LogLevel = "warn";
new Logger({ level: threshold });
```

### `isLevelEnabled(level)` / `ifLevelEnabled(level, fn)`

`isLevelEnabled(level: LogLevel): boolean` — whether a level would be emitted.
Check it before building an expensive context object.

`ifLevelEnabled(level: LogLevel, fn: (log: Logger) => void): void` — the callback
form.

### `log(level, message, context?)`

`log(level: LogLevel, message: string, context?: Record<string, unknown>): void` —
log at a level chosen at runtime.

### `consoleSink(pretty?)`

`consoleSink(pretty = false): Sink` — the default sink. JSON to stdout, or a pretty
single line.

### `MemorySink`

Collects records in memory — for tests.

| Member | Signature |
|--------|-----------|
| `sink` | `Sink` — hand this to `LoggerOptions.sink` |
| `records` | `LogRecord[]` |
| `at` | `(level) => LogRecord[]` |
| `messages` | `() => string[]` |
| `clear` | `() => void` |

### `setLogger(logger, name)` / `namedLogger(name)`

Register a logger under a name, and resolve it. `namedLogger` throws for an unknown
name.

### Interfaces & types (added)

#### `Sink`

`type Sink = (record: LogRecord) => void` — where log lines go.

#### `LogRecord`

`{ level: LogLevel; time: string; msg: string; fields: Record<string, unknown> }` —
`fields` is already redacted.

#### `RedactOptions`

`{ paths: string[]; censor?: string; remove?: boolean }` — a `*` path segment
matches every key at that level. `LoggerOptions.redact` also accepts a bare
`string[]`.
