import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Tracer,
  MemoryExporter,
  otlpExporter,
  setTelemetry,
  telemetry,
  trace,
  currentSpan,
  setAttributes,
  addEvent,
  traceIds,
  flushTelemetry,
  tracing,
  parseTraceparent,
  traceparent,
  injectTraceContext,
  type SpanData,
} from "../src/core/telemetry.js";

/** A tracer that exports everything, synchronously, into memory. */
function traced(): MemoryExporter {
  const exporter = new MemoryExporter();
  setTelemetry(new Tracer({ serviceName: "test", exporter, batchSize: 1 }));
  return exporter;
}

/* ----------------------------- trace context ------------------------------ */

test("parseTraceparent reads a W3C header, and rejects a malformed one", () => {
  const ctx = parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  assert.deepEqual(ctx, {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    sampled: true,
  });

  assert.equal(parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")?.sampled, false);

  // A bad header must start a fresh trace, never throw the request away.
  assert.equal(parseTraceparent("garbage"), null);
  assert.equal(parseTraceparent(""), null);
  assert.equal(parseTraceparent(null), null);
  assert.equal(parseTraceparent("00-tooshort-00f067aa0ba902b7-01"), null);
});

test("traceparent round-trips", () => {
  const ctx = { traceId: "a".repeat(32), spanId: "b".repeat(16), sampled: true };
  assert.equal(traceparent(ctx), `00-${"a".repeat(32)}-${"b".repeat(16)}-01`);
  assert.deepEqual(parseTraceparent(traceparent(ctx)), ctx);

  const unsampled = { ...ctx, sampled: false };
  assert.match(traceparent(unsampled), /-00$/);
});

/* --------------------------------- spans ---------------------------------- */

test("trace() records a span with timing and attributes", async () => {
  const exporter = traced();

  const result = await trace("charge", async (span) => {
    span.setAttributes({ "order.id": 42 });
    span.setAttribute("currency", "USD");
    return "charged";
  });

  assert.equal(result, "charged");
  assert.equal(exporter.spans.length, 1);

  const span = exporter.spans[0]!;
  assert.equal(span.name, "charge");
  assert.equal(span.kind, "internal");
  assert.equal(span.status, "unset");
  assert.equal(span.attributes["order.id"], 42);
  assert.equal(span.attributes["currency"], "USD");
  assert.equal(span.attributes["service.name"], "test");
  assert.ok(span.endTime >= span.startTime);
  assert.match(span.traceId, /^[0-9a-f]{32}$/);
  assert.match(span.spanId, /^[0-9a-f]{16}$/);
  assert.equal(span.parentSpanId, undefined); // a root span
});

test("spans nest: a child inherits the trace and points at its parent", async () => {
  const exporter = traced();

  await trace("parent", async () => {
    await trace("child", async () => {
      await trace("grandchild", async () => {});
    });
  });

  // Children finish first.
  const [grandchild, child, parent] = exporter.spans as [SpanData, SpanData, SpanData];
  assert.deepEqual(
    exporter.spans.map((s) => s.name),
    ["grandchild", "child", "parent"],
  );

  // One trace, three spans.
  assert.equal(child.traceId, parent.traceId);
  assert.equal(grandchild.traceId, parent.traceId);

  assert.equal(parent.parentSpanId, undefined);
  assert.equal(child.parentSpanId, parent.spanId);
  assert.equal(grandchild.parentSpanId, child.spanId);
});

test("concurrent traces don't get tangled", async () => {
  const exporter = traced();

  // Interleaved awaits would corrupt a naive current-span stack.
  await Promise.all([
    trace("a", async () => {
      await new Promise((r) => setTimeout(r, 10));
      await trace("a-child", async () => {});
    }),
    trace("b", async () => {
      await trace("b-child", async () => {});
    }),
  ]);

  const byName = (n: string) => exporter.named(n)[0]!;

  assert.equal(byName("a-child").parentSpanId, byName("a").spanId);
  assert.equal(byName("b-child").parentSpanId, byName("b").spanId);
  assert.equal(byName("a-child").traceId, byName("a").traceId);
  assert.equal(byName("b-child").traceId, byName("b").traceId);
  // ...and the two traces are genuinely separate.
  assert.notEqual(byName("a").traceId, byName("b").traceId);
});

test("a throw is recorded on the span and rethrown", async () => {
  const exporter = traced();

  await assert.rejects(
    () =>
      trace("boom", async () => {
        throw new Error("kaboom");
      }),
    /kaboom/,
  );

  const span = exporter.spans[0]!;
  assert.equal(span.status, "error");
  assert.equal(span.statusMessage, "kaboom");

  const event = span.events[0]!;
  assert.equal(event.name, "exception");
  assert.equal(event.attributes?.["exception.message"], "kaboom");
  assert.equal(event.attributes?.["exception.type"], "Error");
});

test("currentSpan / setAttributes / addEvent reach the span in scope", async () => {
  const exporter = traced();

  assert.equal(currentSpan(), undefined); // nothing in scope out here
  setAttributes({ ignored: true }); // a no-op, not a crash
  addEvent("ignored");

  await trace("work", async () => {
    assert.ok(currentSpan());
    setAttributes({ tenant: "acme" });
    addEvent("cache miss", { key: "user:1" });
  });

  const span = exporter.spans[0]!;
  assert.equal(span.attributes["tenant"], "acme");
  assert.equal(span.events[0]!.name, "cache miss");
  assert.equal(span.events[0]!.attributes?.["key"], "user:1");
});

test("traceIds() gives the ids to hang on a log line", async () => {
  traced();
  assert.deepEqual(traceIds(), {}); // outside a span

  await trace("work", async () => {
    const ids = traceIds();
    assert.match(ids.trace_id!, /^[0-9a-f]{32}$/);
    assert.match(ids.span_id!, /^[0-9a-f]{16}$/);
    assert.equal(ids.trace_id, currentSpan()!.context.traceId);
  });
});

test("ending a span twice exports it once", async () => {
  const exporter = traced();
  const span = telemetry().startSpan("once");
  span.end();
  span.end();
  assert.equal(exporter.spans.length, 1);
});

/* -------------------------------- sampling -------------------------------- */

test("sampleRatio 0 records nothing; the decision is inherited by children", async () => {
  const exporter = new MemoryExporter();
  setTelemetry(new Tracer({ exporter, sampleRatio: 0, batchSize: 1 }));

  await trace("parent", async () => {
    await trace("child", async () => {});
  });

  // Half a trace is worse than none: the root's decision covers the whole tree.
  assert.equal(exporter.spans.length, 0);
});

test("sampleRatio 1 records everything", async () => {
  const exporter = new MemoryExporter();
  setTelemetry(new Tracer({ exporter, sampleRatio: 1, batchSize: 1 }));

  await trace("parent", async () => {
    await trace("child", async () => {});
  });

  assert.equal(exporter.spans.length, 2);
});

test("enabled: false stops recording", async () => {
  const exporter = new MemoryExporter();
  setTelemetry(new Tracer({ exporter, enabled: false, batchSize: 1 }));

  await trace("work", async () => {});
  assert.equal(exporter.spans.length, 0);
  assert.equal(telemetry().enabled, false);
});

/* -------------------------------- batching -------------------------------- */

test("spans are buffered until the batch fills, and flush() drains the rest", async () => {
  const exporter = new MemoryExporter();
  setTelemetry(new Tracer({ exporter, batchSize: 3 }));

  await trace("a", async () => {});
  await trace("b", async () => {});
  assert.equal(exporter.spans.length, 0, "still buffered");

  await trace("c", async () => {});
  assert.equal(exporter.spans.length, 3, "the batch filled and flushed");

  await trace("d", async () => {});
  assert.equal(exporter.spans.length, 3);

  await flushTelemetry();
  assert.equal(exporter.spans.length, 4, "flush drains the tail");
});

/* -------------------------------- exporters ------------------------------- */

test("otlpExporter posts a well-formed OTLP payload", async () => {
  let captured: { url: string; body: any; headers: any } | undefined;
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = {
      url,
      body: JSON.parse(init.body as string),
      headers: init.headers,
    };
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const exporter = otlpExporter({
      url: "http://collector:4318/v1/traces",
      headers: { "x-api-key": "secret" },
      resource: { "service.name": "api", "deployment.environment": "prod" },
    });

    setTelemetry(new Tracer({ exporter, batchSize: 1 }));
    await trace("charge", async (span) => {
      span.setAttributes({ "order.id": 42, ok: true, ratio: 0.5 });
      span.addEvent("retrying");
    });
    await flushTelemetry();
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(captured!.url, "http://collector:4318/v1/traces");
  assert.equal(captured!.headers["x-api-key"], "secret");

  const resourceSpan = captured!.body.resourceSpans[0];
  assert.deepEqual(resourceSpan.resource.attributes[0], {
    key: "service.name",
    value: { stringValue: "api" },
  });

  const span = resourceSpan.scopeSpans[0].spans[0];
  assert.equal(span.name, "charge");
  assert.equal(span.kind, 1); // INTERNAL
  assert.equal(span.status.code, 0); // UNSET
  assert.match(span.startTimeUnixNano, /^\d+$/);
  assert.match(span.endTimeUnixNano, /^\d+$/);

  // Attributes are typed key/value pairs, not a plain object.
  const attrs = Object.fromEntries(span.attributes.map((a: any) => [a.key, a.value]));
  assert.deepEqual(attrs["order.id"], { intValue: 42 });
  assert.deepEqual(attrs["ok"], { boolValue: true });
  assert.deepEqual(attrs["ratio"], { doubleValue: 0.5 });

  assert.equal(span.events[0].name, "retrying");
});

/* ------------------------------- middleware ------------------------------- */

async function serve(handler: ReturnType<typeof tracing>, url: string, headers: Record<string, string> = {}) {
  const { Hono } = await import("hono");
  const app = new Hono();
  app.use("*", handler);
  app.get("/boom", () => {
    throw new Error("handler exploded");
  });
  app.get("/err", (c) => c.text("nope", 500));
  app.all("*", (c) => c.json({ ok: true }));
  return app.request(new Request(url, { headers }));
}

test("tracing() opens a server span per request", async () => {
  const exporter = traced();

  const res = await serve(tracing(), "http://app.test/users/1", { "user-agent": "curl/8" });
  assert.equal(res.status, 200);

  const span = exporter.spans[0]!;
  assert.equal(span.name, "GET /users/1");
  assert.equal(span.kind, "server");
  assert.equal(span.status, "ok");
  assert.equal(span.attributes["http.request.method"], "GET");
  assert.equal(span.attributes["url.path"], "/users/1");
  assert.equal(span.attributes["http.status_code"], 200);
  assert.equal(span.attributes["user_agent.original"], "curl/8");

  // The trace id comes back on the response, so a slow request can be looked up.
  assert.equal(
    res.headers.get("traceparent"),
    traceparent({ traceId: span.traceId, spanId: span.spanId, sampled: true }),
  );
});

test("tracing() joins the caller's trace when they send a traceparent", async () => {
  const exporter = traced();

  const incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  await serve(tracing(), "http://app.test/users", { traceparent: incoming });

  const span = exporter.spans[0]!;
  assert.equal(span.traceId, "4bf92f3577b34da6a3ce929d0e0e4736", "same trace as the caller");
  assert.equal(span.parentSpanId, "00f067aa0ba902b7", "parented to the caller's span");
});

test("a 5xx fails the span — a 404 does not", async () => {
  const exporter = traced();

  await serve(tracing(), "http://app.test/err");
  assert.equal(exporter.spans[0]!.status, "error");
  assert.equal(exporter.spans[0]!.attributes["http.status_code"], 500);

  // A handler that throws is turned into a 500 by the framework's error handler
  // before it ever reaches us, so it lands here the same way.
  exporter.clear();
  await serve(tracing(), "http://app.test/boom");
  assert.equal(exporter.spans[0]!.status, "error");
  assert.equal(exporter.spans[0]!.attributes["http.status_code"], 500);
});

test("an error that escapes the app is recorded on the span and rethrown", async () => {
  const exporter = traced();

  // No error handler in front of us: the throw propagates through `await next()`.
  const { Hono } = await import("hono");
  const app = new Hono();
  app.onError((err) => {
    throw err; // re-throw, so it escapes past the tracing middleware
  });
  app.use("*", tracing());
  app.get("/boom", () => {
    throw new Error("handler exploded");
  });

  await assert.rejects(() => app.request(new Request("http://app.test/boom")), /handler exploded/);

  const span = exporter.spans[0]!;
  assert.equal(span.status, "error");
  assert.equal(span.events[0]!.name, "exception");
  assert.equal(span.events[0]!.attributes?.["exception.message"], "handler exploded");
});

test("health and favicon paths are ignored by default", async () => {
  const exporter = traced();

  await serve(tracing(), "http://app.test/health/ready");
  await serve(tracing(), "http://app.test/favicon.ico");
  assert.equal(exporter.spans.length, 0);

  await serve(tracing(), "http://app.test/users");
  assert.equal(exporter.spans.length, 1);
});

test("the ignore predicate and span name are configurable", async () => {
  const exporter = traced();

  const handler = tracing({
    ignore: (path) => path.startsWith("/internal"),
    name: (method, path) => `${method} ${path.replace(/\/\d+/, "/:id")}`,
  });

  await serve(handler, "http://app.test/internal/metrics");
  assert.equal(exporter.spans.length, 0);

  await serve(handler, "http://app.test/users/42");
  assert.equal(exporter.spans[0]!.name, "GET /users/:id");
  // /health is no longer ignored, because we replaced the predicate.
  await serve(handler, "http://app.test/health");
  assert.equal(exporter.spans.length, 2);
});

/* ----------------------------- propagation -------------------------------- */

test("injectTraceContext puts the current context on outgoing headers", async () => {
  traced();

  assert.deepEqual(injectTraceContext({ accept: "application/json" }), {
    accept: "application/json",
  });

  await trace("call", async (span) => {
    const headers = injectTraceContext({ accept: "application/json" });
    assert.equal(headers.accept, "application/json");
    assert.equal(headers.traceparent, traceparent(span.context));
    // The downstream service parses it and joins this trace.
    assert.equal(parseTraceparent(headers.traceparent!)!.traceId, span.context.traceId);
  });
});
