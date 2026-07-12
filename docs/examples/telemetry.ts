// Type-check harness for docs/telemetry.md. Compile-only — never executed.
import {
  setTelemetry,
  telemetry,
  Tracer,
  Span,
  otlpExporter,
  consoleExporter,
  MemoryExporter,
  tracing,
  trace,
  currentSpan,
  setAttributes,
  addEvent,
  traceIds,
  flushTelemetry,
  parseTraceparent,
  traceparent,
  injectTraceContext,
  logger,
  onShutdown,
  env,
  HttpKernel,
  type Application,
  type SpanData,
  type SpanContext,
  type SpanExporter,
  type TracerOptions,
  type TracingOptions,
} from "@shaferllc/keel/core";

declare const order: { id: number };
declare const stripe: { charge(id: number): Promise<{ ok: boolean }> };
declare const id: number;
declare const key: string;
declare const orderId: number;
declare const url: string;

export function setup() {
  const options: TracerOptions = {
    serviceName: "api",
    exporter: otlpExporter({ url: "http://localhost:4318/v1/traces" }),
    sampleRatio: 0.1,
    enabled: true,
    resource: { "deployment.environment": "prod" },
    batchSize: 100,
  };
  return setTelemetry(new Tracer(options));
}

export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(tracing());

    const options: TracingOptions = {
      ignore: (path) => path.startsWith("/internal"),
      name: (method, path) => `${method} ${path.replace(/\/\d+/, "/:id")}`,
    };
    this.use(tracing(options));
  }
}

export async function spans() {
  const receipt = await trace("charge", async (span: Span) => {
    span.setAttributes({ "order.id": order.id, currency: "USD" });
    span.setAttribute("retries", 0);
    span.addEvent("calling stripe");
    return stripe.charge(id);
  });

  await trace("checkout", async () => {
    await trace("reserve-stock", async () => {});
    await trace("charge", async () => {});
  });

  return receipt;
}

export function fromInsideASpan() {
  setAttributes({ tenant: "acme" });
  addEvent("cache miss", { key });
  const span: Span | undefined = currentSpan();
  return span;
}

export function logsAndTraces() {
  const log = logger().child(traceIds());
  log.info("charging card", { orderId });
}

export async function propagation() {
  await fetch(url, { headers: injectTraceContext({ accept: "application/json" }) });

  const incoming: SpanContext | null = parseTraceparent("00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01");
  return incoming ? traceparent(incoming) : null;
}

export function exporters(): SpanExporter[] {
  return [
    otlpExporter({
      url: "https://api.honeycomb.io/v1/traces",
      headers: { "x-honeycomb-team": env("HONEYCOMB_KEY", "") },
      resource: { "service.name": "api", "deployment.environment": "prod" },
    }),
    consoleExporter(),
    new MemoryExporter(),
  ];
}

export function flushing() {
  onShutdown(() => flushTelemetry());
  return telemetry().flush();
}

export async function testing() {
  const exporter = new MemoryExporter();
  setTelemetry(new Tracer({ exporter, batchSize: 1 }));

  await trace("charge", async (span) => span.setAttributes({ "order.id": 1 }));

  const span: SpanData | undefined = exporter.named("charge")[0];
  const all: SpanData[] = exporter.trace(span!.traceId);
  exporter.clear();

  return { span, all };
}
