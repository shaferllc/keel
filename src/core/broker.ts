/**
 * A service broker — a Moleculer-style backbone for service-oriented code.
 * Register *services* (a name plus a bag of `actions` and `events`), then reach
 * them by string name: `broker.call("users.get", { id })` runs an action and
 * returns its result; `broker.emit("user.created", user)` fans an event out to
 * every service that listens. Actions receive a `Context` and can call *other*
 * actions or emit events through it, so a request threads its `meta` (auth,
 * trace ids) all the way down.
 *
 *   const broker = new Broker();
 *   broker.createService({
 *     name: "math",
 *     actions: {
 *       add: (ctx: Context<{ a: number; b: number }>) => ctx.params.a + ctx.params.b,
 *     },
 *   });
 *   await broker.start();
 *   await broker.call("math.add", { a: 2, b: 3 });   // 5
 *
 * Like the queue and Redis layers, clustering lives behind a pluggable seam: the
 * default `LocalTransporter` is a single-node no-op, so the core imports no
 * network client and runs on Node and the edge. Swap in a real `Transporter`
 * (NATS, Redis, TCP) to span processes — the call/emit API doesn't change.
 */

import { Logger } from "./logger.js";

/* --------------------------------- context -------------------------------- */

/** How an event was dispatched — `emit` (balanced) or `broadcast` (every listener). */
export type EventType = "emit" | "broadcast";

/** Per-call state, handed to every action and event handler. */
export interface Context<P = any> {
  /** The call parameters (an action's arguments) or an event's payload. */
  params: P;
  /** Metadata that flows down through nested `call`s — auth, trace ids, locale. */
  meta: Record<string, unknown>;
  /** Scratch space shared between this call's hooks and handler; never propagated. */
  locals: Record<string, unknown>;
  /** Per-call headers — like `meta`, but transient: not carried into nested calls. */
  headers: Record<string, unknown>;
  /** The broker handling this call. */
  broker: Broker;
  /** The service whose handler is running. */
  service: Service;
  /** The action or event name currently executing. */
  name: string;
  /** The action being executed (absent in event handlers). */
  action?: { name: string };
  /** The event being handled (absent in action handlers). */
  event?: { name: string; type: EventType; groups: string[] };
  /** In an event handler, the emitted event's name. */
  eventName?: string;
  /** In an event handler, how it was dispatched — `"emit"` or `"broadcast"`. */
  eventType?: EventType;
  /** In an event handler, the groups the event targeted. */
  eventGroups?: string[];
  /** The node this call originated on. */
  nodeID: string;
  /** A unique id for this call, for tracing/logging. */
  id: string;
  /** The `id` of the parent context in a nested call, or `null` at the root. */
  parentID: string | null;
  /** Call depth — `1` at the root, incremented on each nested `call`. */
  level: number;
  /** Full name of the service that invoked this call, or `null` at the root. */
  caller: string | null;
  /** A correlation id shared by every call in the same request tree. */
  requestID: string;
  /** Call another action, inheriting this context's `meta` and `requestID`. */
  call<R = unknown>(action: string, params?: unknown, opts?: CallOptions): Promise<R>;
  /** Call several actions at once, inheriting this context's `meta`. */
  mcall<R = unknown>(defs: MCallDefs, opts?: MCallOptions): Promise<R>;
  /** A serializable snapshot of this context (drops functions and live refs). */
  toJSON(): Record<string, unknown>;
  /** Emit a balanced event, inheriting this context's `meta`. */
  emit(event: string, payload?: unknown, opts?: EmitOptions): Promise<void>;
  /** Broadcast an event to every listener, inheriting this context's `meta`. */
  broadcast(event: string, payload?: unknown, opts?: EmitOptions): Promise<void>;
}

export interface CallOptions {
  /** Metadata merged into (and overriding) the parent context's `meta`. */
  meta?: Record<string, unknown>;
  /** Per-call headers — available as `ctx.headers`, not propagated downstream. */
  headers?: Record<string, unknown>;
  /** Correlation id for the request tree; generated if omitted. */
  requestID?: string;
  /** Milliseconds to wait before rejecting with a `RequestTimeoutError`. */
  timeout?: number;
  /** @internal parent context whose `meta`/`requestID` this call inherits. */
  parentCtx?: Context;
}

export interface EmitOptions {
  meta?: Record<string, unknown>;
  /** Restrict delivery to listeners in these groups (defaults to all listeners). */
  groups?: string[];
}

/** The shape passed to `mcall` — an array of calls, or a map of them by key. */
export type MCallDefs =
  | Array<{ action: string; params?: unknown; opts?: CallOptions }>
  | Record<string, { action: string; params?: unknown; opts?: CallOptions }>;

export interface MCallOptions extends CallOptions {
  /** Return `{ status, value | reason }` per call instead of failing on the first rejection. */
  settled?: boolean;
}

/* --------------------------------- schema --------------------------------- */

/** An action handler — receives a `Context`, returns (or resolves to) a result. */
export type ActionHandler<P = any, R = any> = (ctx: Context<P>) => R | Promise<R>;

/** An event handler — `ctx.params` is the event payload. */
export type EventHandler<P = any> = (ctx: Context<P>) => void | Promise<void>;

/** A before-hook — runs before the handler; mutate `ctx.params`/`meta`/`locals`. */
export type BeforeHook<P = any> = (ctx: Context<P>) => void | Promise<void>;
/** An after-hook — receives the result and returns the (possibly transformed) result. */
export type AfterHook<P = any, R = any> = (ctx: Context<P>, res: R) => R | Promise<R>;
/** An error-hook — receives the thrown error; return a fallback or re-throw. */
export type ErrorHook<P = any> = (ctx: Context<P>, err: Error) => unknown;

/** How far an action is reachable. `private` actions are hidden from `broker.call`. */
export type Visibility = "published" | "public" | "protected" | "private";

/** Hooks bound to a single action, in its full definition. */
export interface ActionHooks {
  before?: BeforeHook | BeforeHook[];
  after?: AfterHook | AfterHook[];
  error?: ErrorHook | ErrorHook[];
}

/** The full form of an action — a handler plus per-action options. */
export interface ActionDef {
  handler: ActionHandler;
  /** Reachability; defaults to `published`. `private` blocks `broker.call`. */
  visibility?: Visibility;
  /** Per-action timeout (ms); overrides the broker default, overridden by the call. */
  timeout?: number;
  /** Hooks that wrap just this action. */
  hooks?: ActionHooks;
}

/** An action entry: a bare handler (shorthand) or a full `ActionDef`. */
export type ActionSchema = ActionHandler | ActionDef;

/** An event entry: a bare handler (shorthand) or a handler plus a `group`. */
export type EventSchema = EventHandler | { group?: string; handler: EventHandler };

/**
 * Service-level hooks, keyed by action name. Keys may be `"*"` (all actions),
 * an exact name, a `"a|b"` pipe list, or a `*` glob (`"get*"`).
 */
export interface ServiceHooks {
  before?: Record<string, BeforeHook | BeforeHook[]>;
  after?: Record<string, AfterHook | AfterHook[]>;
  error?: Record<string, ErrorHook | ErrorHook[]>;
}

/**
 * The shape you hand to `createService`. Handlers and lifecycle hooks run with
 * `this` bound to the live `Service`, so they can reach `this.settings`,
 * `this.broker`, `this.logger`, and any `methods` you define.
 */
export interface ServiceSchema {
  /** Unique service name, e.g. `"users"`. Combined with `version` into a prefix. */
  name: string;
  /** Optional version; `2` or `"2"` namespaces actions as `v2.users.*`. */
  version?: string | number;
  /** Free-form config, readable from handlers as `this.settings`. */
  settings?: Record<string, unknown>;
  /** Arbitrary descriptive info, readable as `this.metadata`. */
  metadata?: Record<string, unknown>;
  /** Service name(s) that must be registered before this service's `started` runs. */
  dependencies?: string | string[];
  /** Reusable schemas merged into this one (this schema always wins on conflict). */
  mixins?: ServiceSchema[];
  /** Named actions — a bare handler, or a full `ActionDef`. */
  actions?: Record<string, ActionSchema>;
  /** Event listeners, keyed by event name (may be a glob, e.g. `"user.*"`). */
  events?: Record<string, EventSchema>;
  /** Private helpers, bound to the service and reachable as `this.<method>`. */
  methods?: Record<string, (...args: any[]) => any>;
  /** Hooks wrapping this service's actions. */
  hooks?: ServiceHooks;
  /** Called after mixins are merged, before the instance is created; receives the schema. */
  merged?(this: void, schema: ServiceSchema): void;
  /** Called synchronously when the service is created. */
  created?(this: Service): void | Promise<void>;
  /** Called during `broker.start()`, after every service is created. */
  started?(this: Service): void | Promise<void>;
  /** Called during `broker.stop()`, in reverse creation order. */
  stopped?(this: Service): void | Promise<void>;
}

/* ----------------------------- schema helpers ----------------------------- */

function toArray<T>(x: T | T[] | undefined | null): T[] {
  return x == null ? [] : Array.isArray(x) ? x : [x];
}

/** Chain two lifecycle hooks into one that awaits both, in order. */
function chain(
  a: ((...args: any[]) => any) | undefined,
  b: ((...args: any[]) => any) | undefined,
): ((...args: any[]) => any) | undefined {
  if (!a) return b;
  if (!b) return a;
  return async function (this: any, ...args: any[]) {
    await a.apply(this, args);
    await b.apply(this, args);
  };
}

const LIFECYCLE = new Set(["created", "started", "stopped", "merged"]);

/** Merge one schema over a base, following Moleculer's per-property rules. */
function mergeSchema(base: any, ext: any): any {
  const out: any = { ...base };
  for (const key of Object.keys(ext)) {
    const v = ext[key];
    if (v === undefined || key === "mixins") continue;
    if (key === "name" || key === "version") {
      out[key] = v;
    } else if (key === "settings" || key === "metadata" || key === "actions" || key === "methods" || key === "events") {
      out[key] = { ...(base[key] ?? {}), ...v };
    } else if (key === "hooks") {
      out[key] = {
        before: { ...(base.hooks?.before ?? {}), ...(v.before ?? {}) },
        after: { ...(base.hooks?.after ?? {}), ...(v.after ?? {}) },
        error: { ...(base.hooks?.error ?? {}), ...(v.error ?? {}) },
      };
    } else if (key === "dependencies") {
      out[key] = [...new Set([...toArray(base[key]), ...toArray(v)])];
    } else if (LIFECYCLE.has(key)) {
      out[key] = chain(base[key], v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Flatten a schema's `mixins` into it — this schema always wins on conflict. */
function applyMixins(schema: ServiceSchema): ServiceSchema {
  if (!schema.mixins?.length) return schema;
  // Fold mixins last→first so the first mixin ends up highest-priority among
  // them; the service's own schema is applied last, so it wins overall.
  let merged: any = {};
  for (const mixin of [...schema.mixins].reverse()) {
    merged = mergeSchema(merged, applyMixins(mixin));
  }
  const { mixins: _drop, ...own } = schema;
  return mergeSchema(merged, own);
}

/* -------------------------------- service --------------------------------- */

/** A normalized action ready to invoke — handlers and hooks already bound. */
interface NormalizedAction {
  name: string;
  handler: ActionHandler;
  visibility: Visibility;
  timeout?: number;
  hooks: { before: BeforeHook[]; after: AfterHook[]; error: ErrorHook[] };
}

interface NormalizedEvent {
  handler: EventHandler;
  group: string;
}

interface NormalizedServiceHooks {
  before: Record<string, BeforeHook[]>;
  after: Record<string, AfterHook[]>;
  error: Record<string, ErrorHook[]>;
}

/** A live service instance. Bound as `this` inside handlers, methods, and hooks. */
export class Service {
  readonly name: string;
  readonly version?: string | number;
  /** Versioned, dotted prefix — `"users"` or `"v2.users"`. */
  readonly fullName: string;
  readonly settings: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  /** Services that must exist before this one's `started` hook runs. */
  readonly dependencies: string[];
  readonly broker: Broker;
  readonly logger: Logger;
  /** Internal callers for this service's own actions — `this.actions.foo(params)`. */
  readonly actions: Record<string, (params?: unknown, opts?: CallOptions) => Promise<unknown>> = {};
  /** Bound `methods` land here (and directly on the instance) — `this.<name>`. */
  [key: string]: any;

  /** @internal normalized actions, keyed by local (unprefixed) name. */
  readonly _actions = new Map<string, NormalizedAction>();
  /** @internal normalized event listeners, keyed by pattern. */
  readonly _events = new Map<string, NormalizedEvent>();
  /** @internal normalized service-level hooks. */
  readonly _hooks: NormalizedServiceHooks;

  constructor(broker: Broker, schema: ServiceSchema) {
    this.name = schema.name;
    this.version = schema.version;
    this.fullName = schema.version != null ? `v${schema.version}.${schema.name}` : schema.name;
    this.settings = schema.settings ?? {};
    this.metadata = schema.metadata ?? {};
    this.dependencies = toArray(schema.dependencies);
    this.broker = broker;
    this.logger = broker.logger.child({ service: this.fullName });

    // Bind methods first so actions/hooks can call them via `this`.
    for (const [key, fn] of Object.entries(schema.methods ?? {})) {
      this[key] = fn.bind(this);
    }

    for (const [name, entry] of Object.entries(schema.actions ?? {})) {
      const def: ActionDef = typeof entry === "function" ? { handler: entry } : entry;
      this._actions.set(name, {
        name,
        handler: def.handler.bind(this),
        visibility: def.visibility ?? "published",
        timeout: def.timeout,
        hooks: {
          before: toArray(def.hooks?.before).map((f) => f.bind(this)),
          after: toArray(def.hooks?.after).map((f) => f.bind(this)),
          error: toArray(def.hooks?.error).map((f) => f.bind(this)),
        },
      });
    }

    for (const [pattern, entry] of Object.entries(schema.events ?? {})) {
      const def = typeof entry === "function" ? { handler: entry } : entry;
      this._events.set(pattern, { handler: def.handler.bind(this), group: def.group ?? this.name });
    }

    const bindHookMap = (m: Record<string, any> | undefined) => {
      const out: Record<string, any[]> = {};
      for (const [key, fns] of Object.entries(m ?? {})) out[key] = toArray(fns).map((f: any) => f.bind(this));
      return out;
    };
    this._hooks = {
      before: bindHookMap(schema.hooks?.before),
      after: bindHookMap(schema.hooks?.after),
      error: bindHookMap(schema.hooks?.error),
    };

    this._schema = schema;
  }

  /** Wait until the named service(s) are registered on this broker. */
  waitForServices(deps: string | string[], timeout?: number, interval?: number): Promise<void> {
    return this.broker.waitForServices(deps, timeout, interval);
  }

  /** @internal the merged schema, for lifecycle hooks. */
  _schema: ServiceSchema;
}

/* --------------------------------- errors --------------------------------- */

/** Thrown by `call` when no action matches the requested name. */
export class ServiceNotFoundError extends Error {
  constructor(readonly action: string) {
    super(`No action named "${action}" is registered.`);
    this.name = "ServiceNotFoundError";
  }
}

/** Thrown by `call` when an action exceeds its timeout. */
export class RequestTimeoutError extends Error {
  constructor(readonly action: string, readonly timeout: number) {
    super(`Action "${action}" timed out after ${timeout}ms.`);
    this.name = "RequestTimeoutError";
  }
}

/* ------------------------------- transporter ------------------------------ */

/**
 * The seam where clustering plugs in. The default `LocalTransporter` is a
 * single-node no-op; a real transporter (NATS, Redis, TCP) would register
 * remote services with the broker on `connect` and relay published packets.
 */
export interface Transporter {
  connect(broker: Broker): Promise<void>;
  disconnect(): Promise<void>;
}

/** The default transporter — a single node, nothing to connect. */
export class LocalTransporter implements Transporter {
  async connect(_broker: Broker): Promise<void> {}
  async disconnect(): Promise<void> {}
}

/**
 * A broker middleware — wraps action calls and taps broker lifecycle. `localAction`
 * receives the next handler in the chain and returns a replacement, so middlewares
 * compose (the first in the array is the outermost). Great for logging, metrics,
 * caching, or auth around every action.
 */
export interface BrokerMiddleware {
  name?: string;
  localAction?(next: ActionHandler, action: string): ActionHandler;
  started?(broker: Broker): void | Promise<void>;
  stopped?(broker: Broker): void | Promise<void>;
}

export interface BrokerOptions {
  /** This node's id. Defaults to a generated `node-<rand>`. */
  nodeID?: string;
  /** Clustering transport. Defaults to `LocalTransporter` (single node). */
  transporter?: Transporter;
  /** Default per-call timeout in ms. `0` (default) disables it. */
  requestTimeout?: number;
  /** Logger to use; defaults to a fresh `Logger`. */
  logger?: Logger;
  /** Middlewares that wrap every action call and tap broker lifecycle. */
  middlewares?: BrokerMiddleware[];
}

/* --------------------------------- broker --------------------------------- */

/** Match a subscription pattern (with optional `*`/`**`/`?` globs) to an event name. */
function eventMatches(pattern: string, event: string): boolean {
  if (pattern === event) return true;
  if (!/[*?]/.test(pattern)) return false;
  // Escape regex specials (but not `*`/`?`), then map globs: `**` spans dots, `*`
  // a single segment, `?` one non-dot char. `user.*` → one level; `user.**` →
  // any depth; `user.??eated` → a fixed-width name.
  const rx = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^.]*")
        .replace(/\?/g, "[^.]") +
      "$",
  );
  return rx.test(event);
}

/** Match a hook key (`"*"`, exact name, `"a|b"` pipe list, or `*` glob) to an action. */
function hookMatches(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern.includes("|")) return pattern.split("|").some((p) => hookMatches(p.trim(), action));
  if (pattern.includes("*")) {
    const rx = new RegExp("^" + pattern.replace(/[.+^${}()[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return rx.test(action);
  }
  return pattern === action;
}

export class Broker {
  readonly nodeID: string;
  readonly logger: Logger;
  private readonly transporter: Transporter;
  private readonly requestTimeout: number;
  private readonly middlewares: BrokerMiddleware[];
  private readonly services: Service[] = [];
  /** action fullName → endpoint. */
  private readonly actions = new Map<string, { service: Service; action: NormalizedAction }>();
  private started = false;
  private uid = 0;

  constructor(options: BrokerOptions = {}) {
    this.nodeID = options.nodeID ?? `node-${Math.random().toString(36).slice(2, 8)}`;
    this.logger = options.logger ?? new Logger({ bindings: { nodeID: options.nodeID } });
    this.transporter = options.transporter ?? new LocalTransporter();
    this.requestTimeout = options.requestTimeout ?? 0;
    this.middlewares = options.middlewares ?? [];
  }

  /* ------------------------------ registration ---------------------------- */

  /** Register a service from a schema (flattening any `mixins`). Returns the instance. */
  createService(rawSchema: ServiceSchema): Service {
    const schema = applyMixins(rawSchema);
    schema.merged?.(schema);

    const service = new Service(this, schema);
    for (const [name, action] of service._actions) {
      const full = `${service.fullName}.${name}`;
      this.actions.set(full, { service, action });
      // Internal caller: runs the full pipeline (hooks, timeout) but skips the
      // visibility gate, so a service can reach its own `private` actions.
      service.actions[name] = (params?: unknown, opts: CallOptions = {}) =>
        this.invoke(full, { service, action }, params, opts);
    }
    this.services.push(service);
    void service._schema.created?.call(service);
    this.logger.debug("service created", { service: service.fullName });
    void this.broadcast("$services.changed", { service: service.fullName });
    return service;
  }

  /** Look up a local service by (versioned) name. */
  getLocalService(name: string): Service | undefined {
    return this.services.find((s) => s.fullName === name || s.name === name);
  }

  /** Remove a service, running its `stopped` hook and unregistering its actions. */
  async destroyService(service: Service): Promise<void> {
    for (const name of service._actions.keys()) {
      this.actions.delete(`${service.fullName}.${name}`);
    }
    const idx = this.services.indexOf(service);
    if (idx !== -1) this.services.splice(idx, 1);
    if (this.started) await service._schema.stopped?.call(service);
    void this.broadcast("$services.changed", { service: service.fullName });
  }

  /** Resolve once every named service is registered; polls until `timeout` (ms). */
  async waitForServices(deps: string | string[], timeout = 0, interval = 100): Promise<void> {
    const names = toArray(deps).filter(Boolean);
    const missing = () => names.filter((n) => !this.getLocalService(n));
    let pending = missing();
    if (!pending.length) return;
    const startedAt = Date.now();
    while (pending.length) {
      if (timeout && Date.now() - startedAt >= timeout) {
        throw new Error(`waitForServices timed out after ${timeout}ms; still missing: ${pending.join(", ")}`);
      }
      await new Promise((r) => setTimeout(r, interval));
      pending = missing();
    }
  }

  /* ------------------------------- lifecycle ------------------------------ */

  /** Connect the transporter and run every service's `started` hook. */
  async start(): Promise<void> {
    if (this.started) return;
    await this.transporter.connect(this);
    for (const service of this.services) {
      if (service.dependencies.length) {
        await this.waitForServices(service.dependencies, Number(service.settings.$dependencyTimeout) || 0);
      }
      await service._schema.started?.call(service);
    }
    this.started = true;
    for (const mw of this.middlewares) await mw.started?.(this);
    this.logger.info("broker started", { nodeID: this.nodeID, services: this.services.length });
    await this.broadcast("$broker.started");
  }

  /** Run every service's `stopped` hook (reverse order) and disconnect. */
  async stop(): Promise<void> {
    if (!this.started) return;
    await this.broadcast("$broker.stopped");
    for (const service of [...this.services].reverse()) {
      await service._schema.stopped?.call(service);
    }
    for (const mw of [...this.middlewares].reverse()) await mw.stopped?.(this);
    await this.transporter.disconnect();
    this.started = false;
    this.logger.info("broker stopped", { nodeID: this.nodeID });
  }

  /* --------------------------------- calls -------------------------------- */

  /** A short unique id for tracing. */
  generateUid(): string {
    return `${this.nodeID}-${++this.uid}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Invoke an action by name and resolve with its result. */
  async call<R = unknown>(action: string, params?: unknown, opts: CallOptions = {}): Promise<R> {
    const endpoint = this.actions.get(action);
    // `private` actions are unreachable from `call` — hidden as if unregistered.
    if (!endpoint || endpoint.action.visibility === "private") throw new ServiceNotFoundError(action);
    return this.invoke(action, endpoint, params, opts) as Promise<R>;
  }

  /** Invoke several actions at once — pass an array or a keyed map; returns the same shape. */
  async mcall<R = unknown>(defs: MCallDefs, opts: MCallOptions = {}): Promise<R> {
    const { settled, ...callOpts } = opts;
    const run = (d: { action: string; params?: unknown; opts?: CallOptions }) =>
      this.call(d.action, d.params, { ...callOpts, ...d.opts });
    const collect = (p: Promise<unknown>) =>
      settled
        ? p.then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({ status: "rejected" as const, reason }),
          )
        : p;

    if (Array.isArray(defs)) {
      return Promise.all(defs.map((d) => collect(run(d)))) as Promise<R>;
    }
    const entries = Object.entries(defs);
    const keys = entries.map(([k]) => k);
    const values = await Promise.all(entries.map(([, d]) => collect(run(d))));
    return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as R;
  }

  /** The full call pipeline: build context → before hooks → handler → after hooks. */
  private async invoke(
    fullName: string,
    endpoint: { service: Service; action: NormalizedAction },
    params: unknown,
    opts: CallOptions,
  ): Promise<unknown> {
    const { service, action } = endpoint;
    const ctx = this.makeContext(service, fullName, params, opts);
    const { before, after, error } = this.resolveHooks(service, action);
    const timeout = opts.timeout ?? action.timeout ?? this.requestTimeout;

    // Wrap the handler with `localAction` middlewares (first is outermost).
    let handler: ActionHandler = action.handler;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const wrap = this.middlewares[i]!.localAction;
      if (wrap) handler = wrap(handler, fullName);
    }

    const pipeline = (async () => {
      for (const hook of before) await hook(ctx);
      let res = await handler(ctx);
      for (const hook of after) res = await hook(ctx, res);
      return res;
    })();

    try {
      return await (timeout ? this.withTimeout(pipeline, timeout, fullName) : pipeline);
    } catch (err) {
      let current = err as Error;
      for (const hook of error) {
        try {
          return await hook(ctx, current);
        } catch (e) {
          current = e as Error;
        }
      }
      throw current;
    }
  }

  /** Race a promise against a timeout, rejecting with `RequestTimeoutError`. */
  private withTimeout<T>(p: Promise<T>, timeout: number, action: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RequestTimeoutError(action, timeout)), timeout);
    });
    return Promise.race([p, guard]).finally(() => clearTimeout(timer!));
  }

  /**
   * Assemble the hook chains for an action. Before: service wildcard → service
   * named → action. After/Error run in reverse: action → service named →
   * service wildcard.
   */
  private resolveHooks(service: Service, action: NormalizedAction) {
    const gather = (map: Record<string, any[]>, wildcardFirst: boolean) => {
      const wild: any[] = [];
      const named: any[] = [];
      for (const [pattern, fns] of Object.entries(map)) {
        if (!hookMatches(pattern, action.name)) continue;
        (pattern.includes("*") ? wild : named).push(...fns);
      }
      return wildcardFirst ? [...wild, ...named] : [...named, ...wild];
    };
    return {
      before: [...gather(service._hooks.before, true), ...action.hooks.before] as BeforeHook[],
      after: [...action.hooks.after, ...gather(service._hooks.after, false)] as AfterHook[],
      error: [...action.hooks.error, ...gather(service._hooks.error, false)] as ErrorHook[],
    };
  }

  /* -------------------------------- events -------------------------------- */

  /**
   * Emit a *balanced* event: each listening service receives it once. In a
   * multi-node cluster only one instance per service group is chosen; locally,
   * with one instance per service, that's every listener.
   */
  emit(event: string, payload?: unknown, opts: EmitOptions = {}): Promise<void> {
    return this.dispatch(event, payload, opts, false);
  }

  /** Broadcast an event to *every* listener (all instances, all groups). */
  broadcast(event: string, payload?: unknown, opts: EmitOptions = {}): Promise<void> {
    return this.dispatch(event, payload, opts, true);
  }

  /**
   * Broadcast to every *local* listener only. On a single node this is identical
   * to `broadcast`; the distinction matters once a real transporter would
   * otherwise relay the event to remote nodes.
   */
  broadcastLocal(event: string, payload?: unknown, opts: EmitOptions = {}): Promise<void> {
    return this.dispatch(event, payload, opts, true);
  }

  private async dispatch(
    event: string,
    payload: unknown,
    opts: EmitOptions,
    broadcast: boolean,
  ): Promise<void> {
    // Locally there's a single instance per service, so balanced emit and
    // broadcast reach the same handlers; the distinction matters once a real
    // transporter registers remote instances.
    const type: EventType = broadcast ? "broadcast" : "emit";
    for (const service of this.services) {
      for (const [pattern, listener] of service._events) {
        if (!eventMatches(pattern, event)) continue;
        if (opts.groups && !opts.groups.includes(listener.group)) continue;
        const groups = opts.groups ?? [listener.group];
        const ctx = this.makeContext(service, event, payload, { meta: opts.meta }, {
          name: event,
          type,
          groups,
        });
        await listener.handler(ctx);
      }
    }
  }

  /** True if any registered service listens for the given event. */
  hasEventListener(event: string): boolean {
    return this.services.some((s) =>
      [...s._events.keys()].some((pattern) => eventMatches(pattern, event)),
    );
  }

  /* --------------------------------- misc --------------------------------- */

  /**
   * Measure round-trip latency (and clock difference) to a node. With the local
   * transporter there's no network, so both are ~0 — the hook is here for real
   * transporters to implement.
   */
  async ping(nodeID: string = this.nodeID): Promise<{ nodeID: string; elapsedTime: number; timeDiff: number }> {
    return { nodeID, elapsedTime: 0, timeDiff: 0 };
  }

  /** A snapshot of registered action names — handy for debugging. */
  get registeredActions(): string[] {
    return [...this.actions.keys()];
  }

  private makeContext(
    service: Service,
    name: string,
    params: unknown,
    opts: CallOptions,
    evt?: { name: string; type: EventType; groups: string[] },
  ): Context {
    const broker = this;
    const parent = opts.parentCtx;
    const meta = parent ? { ...parent.meta, ...opts.meta } : { ...(opts.meta ?? {}) };
    const requestID = opts.requestID ?? parent?.requestID ?? broker.generateUid();
    // The methods close over `ctx` so nested calls can chain from it (parentID,
    // level, caller); they run only after the object exists, so the self-ref is safe.
    const ctx: Context = {
      params,
      meta,
      locals: {},
      headers: { ...(opts.headers ?? {}) },
      broker,
      service,
      name,
      action: evt ? undefined : { name },
      event: evt,
      eventName: evt?.name,
      eventType: evt?.type,
      eventGroups: evt?.groups,
      nodeID: broker.nodeID,
      id: broker.generateUid(),
      parentID: parent?.id ?? null,
      level: parent ? parent.level + 1 : 1,
      caller: parent?.service?.fullName ?? null,
      requestID,
      call: (action, callParams, callOpts = {}) =>
        broker.call(action, callParams, { ...callOpts, parentCtx: ctx }),
      mcall: (defs, callOpts = {}) => broker.mcall(defs, { ...callOpts, parentCtx: ctx }),
      toJSON: () => ({
        id: ctx.id,
        requestID: ctx.requestID,
        parentID: ctx.parentID,
        level: ctx.level,
        nodeID: ctx.nodeID,
        caller: ctx.caller,
        name: ctx.name,
        eventType: ctx.eventType,
        meta: ctx.meta,
      }),
      emit: (ev, evPayload, evOpts = {}) =>
        broker.emit(ev, evPayload, { ...evOpts, meta: { ...ctx.meta, ...evOpts.meta } }),
      broadcast: (ev, evPayload, evOpts = {}) =>
        broker.broadcast(ev, evPayload, { ...evOpts, meta: { ...ctx.meta, ...evOpts.meta } }),
    };
    return ctx;
  }
}

/* --------------------------------- global --------------------------------- */

let instance = new Broker();

/** Register the default broker returned by `broker()`. */
export function setBroker(next: Broker): Broker {
  instance = next;
  return instance;
}

/** The default broker instance. */
export function broker(): Broker {
  return instance;
}
