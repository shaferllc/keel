/**
 * A small leveled logger. Structured JSON by default (one line per event, ready
 * for log aggregators); pretty single-line output in debug. Bound as a
 * singleton on the application — reach it with the global `logger()` helper.
 *
 *   logger().info("user registered", { userId: user.id });
 *   logger().error("payment failed", { orderId, error });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  /** Minimum level to emit. Default: "info". */
  level?: LogLevel;
  /** Pretty single-line output instead of JSON. Default: false. */
  pretty?: boolean;
  /** Fields merged into every log line. */
  bindings?: Record<string, unknown>;
}

export class Logger {
  private threshold: number;

  constructor(private options: LoggerOptions = {}) {
    this.threshold = LEVELS[options.level ?? "info"];
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) return;
    const time = new Date().toISOString();
    if (this.options.pretty) {
      const extra = context ? " " + JSON.stringify(context) : "";
      const fn = level === "warn" ? console.warn : level === "error" ? console.error : console.log;
      fn(`[${time}] ${level.toUpperCase().padEnd(5)} ${message}${extra}`);
    } else {
      console.log(
        JSON.stringify({ level, time, msg: message, ...this.options.bindings, ...context }),
      );
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.write("error", message, context);
  }

  /** A child logger with additional bound fields (e.g. a request id). */
  child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      ...this.options,
      bindings: { ...this.options.bindings, ...bindings },
    });
  }
}
