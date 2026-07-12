/**
 * A small leveled logger. Structured JSON by default (one line per event, ready
 * for log aggregators); pretty single-line output in debug. Bound as a
 * singleton on the application — reach it with the global `logger()` helper.
 *
 *   logger().info("user registered", { userId: user.id });
 *   logger().error("payment failed", { orderId, error });
 *
 * Output goes through a `Sink` — `console` by default, but any function, so logs
 * can go to a file, an HTTP collector, or a buffer in tests. Register extra
 * loggers by name (`setLogger(audit, "audit")`) when a subsystem needs its own
 * level or destination.
 */

/** Levels, quietest last. `trace` is the most verbose; `fatal` the most severe. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** One log event, as handed to a `Sink`. */
export interface LogRecord {
  level: LogLevel;
  /** ISO 8601. */
  time: string;
  msg: string;
  /** Bindings merged with the call's context, after redaction. */
  fields: Record<string, unknown>;
}

/** Where log lines go. Return nothing; a sink that throws is a sink that lies. */
export type Sink = (record: LogRecord) => void;

export interface RedactOptions {
  /**
   * Field paths to redact — a top-level key (`"password"`), a dot path
   * (`"req.headers.authorization"`), or a wildcard segment (`"*.password"`,
   * `"user.*.token"`).
   */
  paths: string[];
  /** What to replace matched values with. Default: `"[redacted]"`. */
  censor?: string;
  /** Delete the key outright instead of censoring it. Default: false. */
  remove?: boolean;
}

export interface LoggerOptions {
  /** Minimum level to emit. Default: "info". */
  level?: LogLevel;
  /** Pretty single-line output instead of JSON. Default: false. */
  pretty?: boolean;
  /** Fields merged into every log line. */
  bindings?: Record<string, unknown>;
  /**
   * Field paths to redact. A `string[]` is shorthand for `{ paths }` — matched
   * values become `"[redacted]"`.
   */
  redact?: string[] | RedactOptions;
  /** Where lines go. Default: the console (`console.log` / `.warn` / `.error`). */
  sink?: Sink;
  /** Silence the logger entirely — nothing is emitted, at any level. */
  enabled?: boolean;
}

const REDACTED = "[redacted]";

function normalizeRedact(redact: LoggerOptions["redact"]): Required<RedactOptions> | undefined {
  if (!redact) return undefined;
  const options = Array.isArray(redact) ? { paths: redact } : redact;
  if (!options.paths.length) return undefined;
  return { paths: options.paths, censor: options.censor ?? REDACTED, remove: options.remove ?? false };
}

/**
 * Return a copy of `obj` with `keys` (a split dot path) redacted. Clones only
 * along the path, so untouched branches keep their identity. A `*` segment
 * matches every key at that level.
 */
function redactPath(
  obj: Record<string, unknown>,
  keys: string[],
  options: Required<RedactOptions>,
): Record<string, unknown> {
  const [head, ...rest] = keys;
  if (head === undefined) return obj;

  const targets = head === "*" ? Object.keys(obj) : head in obj ? [head] : [];
  if (!targets.length) return obj;

  const clone = { ...obj };
  for (const key of targets) {
    if (rest.length === 0) {
      if (options.remove) delete clone[key];
      else clone[key] = options.censor;
    } else {
      const child = clone[key];
      if (child && typeof child === "object" && !Array.isArray(child)) {
        clone[key] = redactPath(child as Record<string, unknown>, rest, options);
      }
    }
  }
  return clone;
}

/** The default sink: JSON to stdout, or a pretty single line when `pretty`. */
export function consoleSink(pretty = false): Sink {
  return ({ level, time, msg, fields }) => {
    const write =
      level === "warn"
        ? console.warn
        : level === "error" || level === "fatal"
          ? console.error
          : console.log;

    if (pretty) {
      const extra = Object.keys(fields).length ? " " + JSON.stringify(fields) : "";
      write(`[${time}] ${level.toUpperCase().padEnd(5)} ${msg}${extra}`);
    } else {
      write(JSON.stringify({ level, time, msg, ...fields }));
    }
  };
}

/** A sink that collects records in memory — for tests. Assert on `.records`. */
export class MemorySink {
  readonly records: LogRecord[] = [];

  /** The sink function to hand to `LoggerOptions.sink`. */
  readonly sink: Sink = (record) => {
    this.records.push(record);
  };

  /** Records at one level. */
  at(level: LogLevel): LogRecord[] {
    return this.records.filter((r) => r.level === level);
  }

  /** The messages logged, in order. */
  messages(): string[] {
    return this.records.map((r) => r.msg);
  }

  clear(): void {
    this.records.length = 0;
  }
}

export class Logger {
  private threshold: number;
  private redact?: Required<RedactOptions>;
  private sink: Sink;

  constructor(private options: LoggerOptions = {}) {
    this.threshold = LEVELS[options.level ?? "info"];
    this.redact = normalizeRedact(options.redact);
    this.sink = options.sink ?? consoleSink(options.pretty);
  }

  /**
   * Whether a level would be emitted. Check it before building an expensive
   * context object — the work of assembling it happens whether or not the line
   * is ever written.
   *
   *   if (logger().isLevelEnabled("debug")) {
   *     logger().debug("state", { snapshot: expensiveSnapshot() });
   *   }
   */
  isLevelEnabled(level: LogLevel): boolean {
    return this.options.enabled !== false && LEVELS[level] >= this.threshold;
  }

  /** Run `fn` only if `level` would be emitted — the callback form of the above. */
  ifLevelEnabled(level: LogLevel, fn: (log: Logger) => void): void {
    if (this.isLevelEnabled(level)) fn(this);
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.isLevelEnabled(level)) return;

    let fields: Record<string, unknown> = { ...this.options.bindings, ...context };
    if (this.redact) {
      for (const path of this.redact.paths) {
        fields = redactPath(fields, path.split("."), this.redact);
      }
    }

    this.sink({ level, time: new Date().toISOString(), msg: message, fields });
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.write("trace", message, context);
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
  /** An unrecoverable failure — the loudest level. */
  fatal(message: string, context?: Record<string, unknown>): void {
    this.write("fatal", message, context);
  }

  /** Log at a level chosen at runtime. */
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    this.write(level, message, context);
  }

  /** A child logger with additional bound fields (e.g. a request id). */
  child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      ...this.options,
      bindings: { ...this.options.bindings, ...bindings },
    });
  }
}

/* -------------------------------- registry -------------------------------- */

const loggers = new Map<string, Logger>();

/**
 * Register a logger under a name, so a subsystem can have its own level or
 * destination:
 *
 *   setLogger(new Logger({ level: "trace", sink: auditSink }), "audit");
 *   namedLogger("audit").trace("permission granted", { userId });
 *
 * The default logger is the application's `Logger` singleton — resolve that with
 * the global `logger()` helper, not this.
 */
export function setLogger(instance: Logger, name: string): Logger {
  loggers.set(name, instance);
  return instance;
}

/** A logger registered with `setLogger`. Throws for an unknown name. */
export function namedLogger(name: string): Logger {
  const instance = loggers.get(name);
  if (!instance) {
    throw new Error(`No logger named "${name}". Register it with setLogger(logger, name).`);
  }
  return instance;
}
