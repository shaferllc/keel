// Type-check harness for docs/logger.md. Every type-checkable snippet in the
// reference is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import {
  logger,
  Logger,
  requestLogger,
  requestLog,
  HttpKernel,
  type LoggerOptions,
  type LogLevel,
} from "@shaferllc/keel/core";

declare const user: { id: number };
declare const key: string;
declare const orderId: number;
declare const err: unknown;
declare const sql: string;
declare const ms: number;
declare const requestId: string;
declare const jobId: string;

export function logging() {
  logger().info("user registered", { userId: user.id });
  logger().warn("cache miss", { key });
  logger().error("payment failed", { orderId, error: String(err) });
  logger().debug("query", { sql, ms });
}

export function levels() {
  const threshold: LogLevel = "warn";
  new Logger({ level: threshold });
}

export function childLoggers() {
  const log = logger().child({ requestId });
  log.info("handling");
  log.info("done");

  const base = logger().child({ service: "billing" });
  const job = base.child({ jobId });
  job.info("start");
}

export function constructing() {
  const log = new Logger({ level: "debug", pretty: true, bindings: { env: "dev" } });
  log.debug("boot", { pid: 1 });

  const bare = new Logger();
  bare.info("no options");
}

export function reference() {
  logger().info("ready");

  const log = new Logger({ level: "warn", pretty: true });
  log.debug("cache lookup", { key });
  log.info("user registered", { userId: 42 });
  log.warn("cache miss", { key });
  log.error("payment failed", { orderId, error: String(err) });

  const reqLog = logger().child({ requestId });
  reqLog.info("handling");
}

export function redaction() {
  const log = new Logger({ redact: ["password", "req.headers.authorization"] });
  log.info("login", {
    user: "ada",
    password: "s3cret",
    req: { headers: { authorization: "Bearer x" } },
  });
}

export function perRequest(kernel: HttpKernel) {
  kernel.use(requestLogger());
  kernel.use(requestLogger({ idHeader: "x-request-id", logRequests: false }));
}

export function inRequest() {
  requestLog().info("charging card", { orderId: 1 });
}

// Interface / type seams
const options: LoggerOptions = {
  level: "debug",
  pretty: true,
  bindings: { app: "api" },
  redact: ["password"],
};
const level: LogLevel = "warn";
export { options, level };
