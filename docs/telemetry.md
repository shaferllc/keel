# Telemetry

Distributed tracing — spans, W3C trace context, and an OTLP exporter — with **no
SDK**.

```ts
import { setTelemetry, Tracer, otlpExporter, tracing, trace } from "@shaferllc/keel/core";

setTelemetry(
  new Tracer({
    serviceName: "api",
    exporter: otlpExporter({ url: "http://localhost:4318/v1/traces" }),
    sampleRatio: 0.1, // 10% of traces in production
  }),
);

// in your HTTP kernel
this.use(tracing()); // a server span per request
```

```ts
// your own spans, anywhere
await trace("charge", async (span) => {
  span.setAttributes({ "order.id": order.id });
  await stripe.charge(order);
});
```

## Why there's no SDK here

The OpenTelemetry Node SDK is a large tree of packages that assumes a Node
process. What a trace actually **is**, though, is small: an id, a parent, a start
and an end, some attributes — and a documented JSON shape to POST them in.

That's what this is. It speaks **OTLP/HTTP over `fetch`**, so it runs on Workers as
happily as on Node, and any OTLP collector accepts it — Jaeger, Tempo, Honeycomb,
Grafana, Datadog. You don't get the SDK's auto-instrumentation of every library
under the sun; you get the part that matters, in about 400 lines you can read.

## Spans

`trace(name, fn)` opens a span, runs your function inside it, and closes it — even
if the function throws, in which case the error is recorded on the span and
rethrown.

```ts
const receipt = await trace("charge", async (span) => {
  span.setAttributes({ "order.id": id, currency: "USD" });
  span.addEvent("calling stripe");

  return stripe.charge(id); // a throw here marks the span failed, then propagates
});
```

**Spans nest automatically.** A `trace()` inside another `trace()` becomes its
child, sharing the trace id — you don't thread anything through:

```ts
await trace("checkout", async () => {
  await trace("reserve-stock", async () => { … }); // child
  await trace("charge", async () => { … }); // sibling of the above
});
```

That works across `await` boundaries, and across **concurrent** traces, because
the current span is tracked in `AsyncLocalStorage` rather than a global. Two
requests in flight at once don't get tangled.

From anywhere inside a span:

```ts
setAttributes({ tenant: "acme" }); // add to the current span
addEvent("cache miss", { key }); // a timestamped annotation
currentSpan(); // the Span itself, or undefined
```

All of these are **no-ops outside a span**, so instrumented code stays safe to call
from a script or a test.

## HTTP requests

`tracing()` opens a **server span** per request, records the method, path, and
status, and closes it when the response is sent.

```ts
this.use(tracing());
```

A 5xx marks the span failed; a 404 doesn't — that's a valid answer, not a fault.

It also writes a `traceparent` header onto the **response**, so when a user says
"this page was slow", you can look up their exact trace.

`/health/*`, `/metrics`, and `/favicon.ico` are ignored by default — they're noise.
Change that with `ignore`, and name spans yourself with `name`:

```ts
this.use(
  tracing({
    ignore: (path) => path.startsWith("/internal"),
    name: (method, path) => `${method} ${path.replace(/\/\d+/, "/:id")}`,
  }),
);
```

## Following a trace between services

This is the point of tracing: one id spanning every service a request touches.

**Incoming.** `tracing()` reads the caller's `traceparent` header and makes your
span a **child of theirs**, so both land in the same trace. A missing or malformed
header just starts a fresh trace — never an error.

**Outgoing.** `injectTraceContext()` puts the current context on your request
headers, so the service you call joins this trace instead of starting its own:

```ts
await fetch(url, {
  headers: injectTraceContext({ accept: "application/json" }),
});
```

`parseTraceparent()` and `traceparent()` are the two halves on their own, if you
need to carry the context somewhere odd — a queue payload, say.

## Connecting logs to traces

`traceIds()` returns the current `trace_id` and `span_id`. Bind them to your logger
and every line becomes a jumping-off point into the trace it came from:

```ts
const log = logger().child(traceIds());
log.info("charging card", { orderId }); // carries trace_id + span_id
```

## Sampling

Recording every trace in production is expensive. `sampleRatio` records a fraction:

```ts
new Tracer({ sampleRatio: 0.1 }); // 10%
```

The decision is made **once, at the root span, and inherited by every child** —
because half a trace is worse than no trace. An unsampled span still runs (your
code is unaffected); it just isn't exported.

## Exporters

| Exporter | Use |
|----------|-----|
| `otlpExporter({ url, headers, resource })` | Any OTLP/HTTP collector. Production. |
| `consoleExporter()` | Prints each span. Local development, no collector needed. |
| `MemoryExporter` | Collects spans in memory. Tests. |

```ts
otlpExporter({
  url: "https://api.honeycomb.io/v1/traces",
  headers: { "x-honeycomb-team": env("HONEYCOMB_KEY") },
  resource: { "service.name": "api", "deployment.environment": "prod" },
});
```

Spans are **buffered** and sent in batches (100 by default, via `batchSize`).

**Flush before the process — or the isolate — goes away**, or the last few spans
die with it:

```ts
onShutdown(() => flushTelemetry());
```

On Workers, call it at the end of a request (ideally inside `waitUntil`).

## Testing

`MemoryExporter` collects spans so you can assert on them:

```ts
import { Tracer, MemoryExporter, setTelemetry, trace } from "@shaferllc/keel/core";

const exporter = new MemoryExporter();
setTelemetry(new Tracer({ exporter, batchSize: 1 })); // batchSize 1 = export immediately

await trace("charge", async (span) => span.setAttributes({ "order.id": 1 }));

const span = exporter.named("charge")[0];
assert.equal(span.status, "unset");
assert.equal(span.attributes["order.id"], 1);
```

`exporter.trace(traceId)` returns every span in one trace; `exporter.clear()`
empties it between tests.

---

## API reference

### `trace(name, fn, options?)`

`trace<T>(name: string, fn: (span: Span) => Promise<T> | T, options?: SpanOptions): Promise<T>`

Run `fn` inside a span. The span is current for the duration, ends when `fn`
settles, and records a throw before rethrowing it.

### `currentSpan()` / `setAttributes(attrs)` / `addEvent(name, attrs?)`

Reach the span in scope. All no-ops outside one.

### `traceIds()`

`traceIds(): { trace_id?: string; span_id?: string }` — the ids to hang on a log
line.

### `tracing(options?)`

`tracing(options?: TracingOptions): MiddlewareHandler`

A server span per request. Options: `ignore(path)` (default: `/health`, `/metrics`,
`/favicon.ico`), `name(method, path)`.

### `Tracer`

`new Tracer(options: TracerOptions)`

| Option | Meaning |
|--------|---------|
| `serviceName` | Added to every span as `service.name` |
| `exporter` | Where finished spans go. Omit and nothing is exported |
| `sampleRatio` | 0–1, decided once at the root. Default 1 |
| `enabled` | `false` turns tracing off |
| `resource` | Attributes describing the service, sent with each batch |
| `batchSize` | Export once this many spans are buffered. Default 100 |

Methods: `startSpan(name, options?)`, `trace(name, fn, options?)`, `flush()`.

### `Span`

`setAttribute(k, v)` / `setAttributes(attrs)` / `addEvent(name, attrs?)` /
`setStatus(status, message?)` / `recordException(error)` / `end()`, plus a
`context` (`{ traceId, spanId, sampled }`).

### `setTelemetry(tracer)` / `telemetry()` / `flushTelemetry()`

Register the active tracer, read it, and drain its buffer.

### Trace context

`parseTraceparent(header)` → `SpanContext | null` (null on anything malformed).
`traceparent(context)` → the header string.
`injectTraceContext(headers?)` → headers with the current context added.

### Exporters

`otlpExporter({ url, headers?, resource? })`, `consoleExporter()`, and
`MemoryExporter` (`.spans`, `.named(name)`, `.trace(traceId)`, `.clear()`).

### Interfaces & types

`SpanData`, `SpanContext`, `SpanEvent`, `SpanKind`
(`internal | server | client | producer | consumer`), `SpanStatus`
(`unset | ok | error`), `SpanAttributes`, `SpanExporter`, `TracerOptions`,
`TracingOptions`, `OtlpOptions`.
