/**
 * Tracing — spans, W3C trace context, and an OTLP exporter, with **no SDK**.
 *
 *   setTelemetry(new Tracer({ serviceName: "api", exporter: otlpExporter({ url }) }));
 *   this.use(tracing());                       // a server span per request
 *
 *   await trace("charge", async (span) => {    // your own spans, nested
 *     span.setAttributes({ "order.id": id });
 *     await stripe.charge(id);
 *   });
 *
 * The OpenTelemetry Node SDK is a large tree of packages that assumes a Node
 * process. What a trace actually *is*, though, is small: an id, a parent, a
 * start and end, some attributes — and a documented JSON shape to POST them in.
 * That's what this is. It speaks OTLP/HTTP over `fetch`, so it runs on Workers
 * as happily as on Node, and any OTLP collector (Jaeger, Tempo, Honeycomb,
 * Grafana, Datadog) accepts it.
 *
 * Spans nest through `AsyncLocalStorage`, so `currentSpan()` works inside an
 * `await` chain without threading a span through every call.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";

/* --------------------------------- ids ------------------------------------ */

function hex(bytes: number): string {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return [...out].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 hex chars. */
const newTraceId = (): string => hex(16);
/** 16 hex chars. */
const newSpanId = (): string => hex(8);

/* -------------------------------- context --------------------------------- */

/** The three things that identify a span across a process boundary. */
export interface SpanContext {
  traceId: string;
  spanId: string;
  /** Whether this trace is being recorded. Propagates to children. */
  sampled: boolean;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Parse a W3C `traceparent` header. Returns null if it's absent or malformed —
 * a bad header must start a fresh trace, never throw a request away.
 */
export function parseTraceparent(header: string | null | undefined): SpanContext | null {
  const match = TRACEPARENT.exec((header ?? "").trim());
  if (!match) return null;
  return {
    traceId: match[1]!,
    spanId: match[2]!,
    sampled: (parseInt(match[3]!, 16) & 1) === 1,
  };
}

/** Format a span context as a W3C `traceparent` header. */
export function traceparent(context: SpanContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

/**
 * Add the current trace context to outgoing request headers, so the service you
 * call joins **this** trace instead of starting its own.
 *
 *   await fetch(url, { headers: injectTraceContext({ accept: "application/json" }) });
 */
export function injectTraceContext(headers: Record<string, string> = {}): Record<string, string> {
  const merged = { ...headers };
  const span = currentSpan();
  if (span) merged.traceparent = traceparent(span.context);
  return merged;
}

/* ---------------------------------- spans --------------------------------- */

export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";
export type SpanStatus = "unset" | "ok" | "error";

export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, SpanAttributeValue>;

/** A timestamped annotation inside a span. */
export interface SpanEvent {
  name: string;
  /** Epoch milliseconds. */
  time: number;
  attributes?: SpanAttributes;
}

/** A finished span, as handed to an exporter. */
export interface SpanData {
  name: string;
  kind: SpanKind;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  /** Epoch milliseconds. */
  startTime: number;
  endTime: number;
  attributes: SpanAttributes;
  events: SpanEvent[];
  status: SpanStatus;
  statusMessage?: string;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: SpanAttributes;
  /** Force a parent instead of using the current span. */
  parent?: SpanContext;
}

export class Span {
  readonly context: SpanContext;
  readonly parentSpanId?: string;
  private readonly startTime = Date.now();
  private attributes: SpanAttributes = {};
  private events: SpanEvent[] = [];
  private status: SpanStatus = "unset";
  private statusMessage?: string;
  private ended = false;

  constructor(
    readonly name: string,
    readonly kind: SpanKind,
    context: SpanContext,
    parentSpanId: string | undefined,
    private readonly tracer: Tracer,
    attributes: SpanAttributes = {},
  ) {
    this.context = context;
    this.parentSpanId = parentSpanId;
    this.attributes = { ...attributes };
  }

  setAttribute(key: string, value: SpanAttributeValue): this {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: SpanAttributes): this {
    Object.assign(this.attributes, attributes);
    return this;
  }

  /** A timestamped annotation — "cache miss", "retrying" — inside this span. */
  addEvent(name: string, attributes?: SpanAttributes): this {
    this.events.push({ name, time: Date.now(), ...(attributes ? { attributes } : {}) });
    return this;
  }

  setStatus(status: SpanStatus, message?: string): this {
    this.status = status;
    this.statusMessage = message;
    return this;
  }

  /** Mark the span failed and record the error as an event. */
  recordException(error: unknown): this {
    const message = error instanceof Error ? error.message : String(error);
    this.addEvent("exception", {
      "exception.message": message,
      "exception.type": error instanceof Error ? error.name : typeof error,
    });
    return this.setStatus("error", message);
  }

  /** Finish the span and hand it to the exporter. Ending twice is a no-op. */
  end(): void {
    if (this.ended) return;
    this.ended = true;

    // An unsampled span is measured but never exported — that's what sampling is.
    if (!this.context.sampled) return;

    this.tracer.record({
      name: this.name,
      kind: this.kind,
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      ...(this.parentSpanId ? { parentSpanId: this.parentSpanId } : {}),
      startTime: this.startTime,
      endTime: Date.now(),
      attributes: this.attributes,
      events: this.events,
      status: this.status,
      ...(this.statusMessage ? { statusMessage: this.statusMessage } : {}),
    });
  }
}

/* -------------------------------- exporters ------------------------------- */

/** Where finished spans go. */
export interface SpanExporter {
  export(spans: SpanData[]): Promise<void> | void;
}

/** Collects spans in memory — for tests. Assert on `.spans`. */
export class MemoryExporter implements SpanExporter {
  readonly spans: SpanData[] = [];

  export(spans: SpanData[]): void {
    this.spans.push(...spans);
  }

  /** The spans with a given name. */
  named(name: string): SpanData[] {
    return this.spans.filter((s) => s.name === name);
  }

  /** Every span in one trace, in the order they finished. */
  trace(traceId: string): SpanData[] {
    return this.spans.filter((s) => s.traceId === traceId);
  }

  clear(): void {
    this.spans.length = 0;
  }
}

/** Prints each span — for local development, when you have no collector. */
export function consoleExporter(): SpanExporter {
  return {
    export(spans) {
      for (const span of spans) {
        const ms = span.endTime - span.startTime;
        console.log(
          `[trace] ${span.name} ${ms}ms ${span.status}`,
          { traceId: span.traceId, spanId: span.spanId, ...span.attributes },
        );
      }
    },
  };
}

export interface OtlpOptions {
  /** The collector's trace endpoint, e.g. `http://localhost:4318/v1/traces`. */
  url: string;
  /** Extra headers — an API key, usually. */
  headers?: Record<string, string>;
  /** Resource attributes describing this service. */
  resource?: SpanAttributes;
}

const KIND_CODE: Record<SpanKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
};
const STATUS_CODE: Record<SpanStatus, number> = { unset: 0, ok: 1, error: 2 };

/** OTLP attributes are a list of typed key/value pairs, not a plain object. */
function otlpAttributes(attributes: SpanAttributes): unknown[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value:
      typeof value === "number"
        ? Number.isInteger(value)
          ? { intValue: value }
          : { doubleValue: value }
        : typeof value === "boolean"
          ? { boolValue: value }
          : { stringValue: String(value) },
  }));
}

const nanos = (ms: number): string => `${Math.round(ms * 1e6)}`;

/**
 * POST spans to any OTLP/HTTP collector as JSON — Jaeger, Tempo, Honeycomb,
 * Grafana, Datadog. Uses `fetch`, so it works on Node and the edge.
 */
export function otlpExporter(options: OtlpOptions): SpanExporter {
  return {
    async export(spans) {
      const body = {
        resourceSpans: [
          {
            resource: { attributes: otlpAttributes(options.resource ?? {}) },
            scopeSpans: [
              {
                scope: { name: "keel" },
                spans: spans.map((span) => ({
                  traceId: span.traceId,
                  spanId: span.spanId,
                  ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                  name: span.name,
                  kind: KIND_CODE[span.kind],
                  startTimeUnixNano: nanos(span.startTime),
                  endTimeUnixNano: nanos(span.endTime),
                  attributes: otlpAttributes(span.attributes),
                  events: span.events.map((event) => ({
                    name: event.name,
                    timeUnixNano: nanos(event.time),
                    attributes: otlpAttributes(event.attributes ?? {}),
                  })),
                  status: {
                    code: STATUS_CODE[span.status],
                    ...(span.statusMessage ? { message: span.statusMessage } : {}),
                  },
                })),
              },
            ],
          },
        ],
      };

      await fetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(body),
      });
    },
  };
}

/* --------------------------------- tracer --------------------------------- */

export interface TracerOptions {
  /** Shows up as `service.name` on every span. */
  serviceName?: string;
  /** Where finished spans go. Omit and spans are recorded but dropped. */
  exporter?: SpanExporter;
  /**
   * The fraction of traces to record, 0–1. Default: 1 (everything). A sampling
   * decision is made once, at the root, and **inherited** by every child — half a
   * trace is worse than none.
   */
  sampleRatio?: number;
  /** Turn tracing off entirely. */
  enabled?: boolean;
  /** SpanAttributes describing this service, sent with every batch. */
  resource?: SpanAttributes;
  /** Export once this many spans are buffered. Default: 100. */
  batchSize?: number;
}

const storage = new AsyncLocalStorage<Span>();

export class Tracer {
  private buffer: SpanData[] = [];

  constructor(private options: TracerOptions = {}) {}

  get enabled(): boolean {
    return this.options.enabled !== false;
  }

  /** @internal — called by `Span.end()`. */
  record(span: SpanData): void {
    if (!this.options.exporter) return;
    this.buffer.push(span);
    if (this.buffer.length >= (this.options.batchSize ?? 100)) void this.flush();
  }

  /**
   * Send buffered spans to the exporter. Call it before a Worker isolate is torn
   * down (or on shutdown) — otherwise the last few spans die with the process.
   */
  async flush(): Promise<void> {
    if (!this.options.exporter || !this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    await this.options.exporter.export(batch);
  }

  /** Whether a new root trace should be recorded. */
  private sample(): boolean {
    const ratio = this.options.sampleRatio ?? 1;
    return ratio >= 1 ? true : ratio <= 0 ? false : Math.random() < ratio;
  }

  /**
   * Start a span. It becomes the current span for anything run inside
   * `trace()`; a bare `startSpan()` does not, so you must `end()` it yourself.
   */
  startSpan(name: string, options: SpanOptions = {}): Span {
    const parent = options.parent ?? currentSpan()?.context;

    const context: SpanContext = parent
      ? { traceId: parent.traceId, spanId: newSpanId(), sampled: parent.sampled }
      : { traceId: newTraceId(), spanId: newSpanId(), sampled: this.enabled && this.sample() };

    const attributes: SpanAttributes = { ...options.attributes };
    if (this.options.serviceName) attributes["service.name"] = this.options.serviceName;

    return new Span(name, options.kind ?? "internal", context, parent?.spanId, this, attributes);
  }

  /**
   * Run `fn` inside a span: it's the current span for the duration, it ends when
   * `fn` settles, and a throw is recorded on it and rethrown.
   */
  async trace<T>(name: string, fn: (span: Span) => Promise<T> | T, options?: SpanOptions): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      return await storage.run(span, () => fn(span));
    } catch (error) {
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }
}

/* --------------------------------- global --------------------------------- */

let tracer = new Tracer();

/** Register the active tracer. */
export function setTelemetry(next: Tracer): Tracer {
  tracer = next;
  return tracer;
}

/** The active tracer. */
export function telemetry(): Tracer {
  return tracer;
}

/** The span currently in scope, if any. */
export function currentSpan(): Span | undefined {
  return storage.getStore();
}

/** Run `fn` inside a span on the active tracer. */
export function trace<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  options?: SpanOptions,
): Promise<T> {
  return tracer.trace(name, fn, options);
}

/** Add attributes to the current span. A no-op outside one. */
export function setAttributes(attributes: SpanAttributes): void {
  currentSpan()?.setAttributes(attributes);
}

/** Add an event to the current span. A no-op outside one. */
export function addEvent(name: string, attributes?: SpanAttributes): void {
  currentSpan()?.addEvent(name, attributes);
}

/** Send every buffered span to the exporter. */
export function flushTelemetry(): Promise<void> {
  return tracer.flush();
}

/**
 * The current trace and span ids, for putting on a log line — this is what lets
 * you jump from a log to the trace it belongs to.
 *
 *   logger().child(traceIds()).info("charging card");
 */
export function traceIds(): { trace_id?: string; span_id?: string } {
  const span = currentSpan();
  if (!span) return {};
  return { trace_id: span.context.traceId, span_id: span.context.spanId };
}

/* ------------------------------- middleware ------------------------------- */

export interface TracingOptions {
  /** Paths to skip — health checks and favicons are noise. Default: those. */
  ignore?: (path: string) => boolean;
  /** Name the span. Default: `"GET /users/:id"` (the route pattern when known). */
  name?: (method: string, path: string) => string;
}

const IGNORED = /^\/(health|metrics|favicon\.ico)/;

/**
 * A server span for every request, joined to the caller's trace when they send a
 * `traceparent`. Records method, path, and status; a 5xx or a thrown error marks
 * the span failed.
 *
 *   this.use(tracing());
 */
export function tracing(options: TracingOptions = {}): MiddlewareHandler {
  const ignore = options.ignore ?? ((path: string) => IGNORED.test(path));

  return async (c, next) => {
    const url = new URL(c.req.url);
    if (!tracer.enabled || ignore(url.pathname)) return next();

    const method = c.req.method;
    const parent = parseTraceparent(c.req.header("traceparent")) ?? undefined;
    const name = options.name?.(method, url.pathname) ?? `${method} ${url.pathname}`;

    await tracer.trace(
      name,
      async (span) => {
        try {
          await next();
        } catch (error) {
          span.recordException(error);
          throw error;
        }

        const status = c.res.status;
        span.setAttribute("http.status_code", status);
        // 5xx is the server's fault, so it fails the span. A 404 is a valid answer.
        span.setStatus(status >= 500 ? "error" : "ok");

        // Hand the trace id back, so a user reporting a slow page can be looked up.
        c.header("traceparent", traceparent(span.context));
      },
      {
        kind: "server",
        parent,
        attributes: {
          "http.request.method": method,
          "url.path": url.pathname,
          "url.scheme": url.protocol.replace(":", ""),
          ...(c.req.header("user-agent") ? { "user_agent.original": c.req.header("user-agent")! } : {}),
        },
      },
    );
  };
}
