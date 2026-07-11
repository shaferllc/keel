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

/** Per-call state, handed to every action and event handler. */
export interface Context<P = any> {
  /** The call parameters (an action's arguments) or an event's payload. */
  params: P;
  /** Metadata that flows down through nested `call`s — auth, trace ids, locale. */
  meta: Record<string, unknown>;
  /** The broker handling this call. */
  broker: Broker;
  /** The service whose handler is running. */
  service: Service;
  /** The action or event name currently executing. */
  name: string;
  /** The node this call originated on. */
  nodeID: string;
  /** A unique id for this call, for tracing/logging. */
  id: string;
  /** Call another action, inheriting this context's `meta`. */
  call<R = unknown>(action: string, params?: unknown, opts?: CallOptions): Promise<R>;
  /** Emit a balanced event, inheriting this context's `meta`. */
  emit(event: string, payload?: unknown, opts?: EmitOptions): Promise<void>;
  /** Broadcast an event to every listener, inheriting this context's `meta`. */
  broadcast(event: string, payload?: unknown, opts?: EmitOptions): Promise<void>;
}

export interface CallOptions {
  /** Metadata merged into (and overriding) the parent context's `meta`. */
  meta?: Record<string, unknown>;
  /** Milliseconds to wait before rejecting with a `RequestTimeoutError`. */
  timeout?: number;
}

export interface EmitOptions {
  meta?: Record<string, unknown>;
  /** Restrict delivery to services in these groups (defaults to all listeners). */
  groups?: string[];
}

/* --------------------------------- schema --------------------------------- */

/** An action handler — receives a `Context`, returns (or resolves to) a result. */
export type ActionHandler<P = any, R = any> = (ctx: Context<P>) => R | Promise<R>;

/** An event handler — `ctx.params` is the event payload. */
export type EventHandler<P = any> = (ctx: Context<P>) => void | Promise<void>;

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
  /** Named actions, callable as `"<fullName>.<action>"`. */
  actions?: Record<string, ActionHandler>;
  /** Event listeners, keyed by event name (may be a glob, e.g. `"user.*"`). */
  events?: Record<string, EventHandler>;
  /** Private helpers, bound to the service and reachable as `this.<method>`. */
  methods?: Record<string, (...args: any[]) => any>;
  /** Called synchronously when the service is created. */
  created?(this: Service): void | Promise<void>;
  /** Called during `broker.start()`, after every service is created. */
  started?(this: Service): void | Promise<void>;
  /** Called during `broker.stop()`, in reverse creation order. */
  stopped?(this: Service): void | Promise<void>;
}

/* -------------------------------- service --------------------------------- */

/** A live service instance. Bound as `this` inside handlers, methods, and hooks. */
export class Service {
  readonly name: string;
  readonly version?: string | number;
  /** Versioned, dotted prefix — `"users"` or `"v2.users"`. */
  readonly fullName: string;
  readonly settings: Record<string, unknown>;
  readonly broker: Broker;
  readonly logger: Logger;
  /** Action names local to this service (unprefixed). */
  readonly actions: Record<string, ActionHandler> = {};
  readonly events: Record<string, EventHandler> = {};
  /** Bound `methods` land here (and directly on the instance) — `this.<name>`. */
  [key: string]: any;

  constructor(broker: Broker, schema: ServiceSchema) {
    this.name = schema.name;
    this.version = schema.version;
    this.fullName = schema.version != null ? `v${schema.version}.${schema.name}` : schema.name;
    this.settings = schema.settings ?? {};
    this.broker = broker;
    this.logger = broker.logger.child({ service: this.fullName });

    // Bind methods first so actions/hooks can call them via `this`.
    for (const [key, fn] of Object.entries(schema.methods ?? {})) {
      this[key] = fn.bind(this);
    }
    for (const [key, fn] of Object.entries(schema.actions ?? {})) {
      this.actions[key] = fn.bind(this);
    }
    for (const [key, fn] of Object.entries(schema.events ?? {})) {
      this.events[key] = fn.bind(this);
    }

    this._schema = schema;
  }

  /** @internal the original schema, for lifecycle hooks. */
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

export interface BrokerOptions {
  /** This node's id. Defaults to a generated `node-<rand>`. */
  nodeID?: string;
  /** Clustering transport. Defaults to `LocalTransporter` (single node). */
  transporter?: Transporter;
  /** Default per-call timeout in ms. `0` (default) disables it. */
  requestTimeout?: number;
  /** Logger to use; defaults to a fresh `Logger`. */
  logger?: Logger;
}

/* --------------------------------- broker --------------------------------- */

/** Match a subscription pattern (with optional `*`/`**` globs) to an event name. */
function eventMatches(pattern: string, event: string): boolean {
  if (pattern === event) return true;
  if (!pattern.includes("*")) return false;
  // Escape regex specials (but not `*`), then map globs: `**` spans dots, `*` a
  // single segment. `user.*` → one level; `user.**` → any depth.
  const rx = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^.]*") +
      "$",
  );
  return rx.test(event);
}

export class Broker {
  readonly nodeID: string;
  readonly logger: Logger;
  private readonly transporter: Transporter;
  private readonly requestTimeout: number;
  private readonly services: Service[] = [];
  /** action fullName → endpoint. */
  private readonly actions = new Map<string, { service: Service; handler: ActionHandler }>();
  private started = false;
  private uid = 0;

  constructor(options: BrokerOptions = {}) {
    this.nodeID = options.nodeID ?? `node-${Math.random().toString(36).slice(2, 8)}`;
    this.logger = options.logger ?? new Logger({ bindings: { nodeID: options.nodeID } });
    this.transporter = options.transporter ?? new LocalTransporter();
    this.requestTimeout = options.requestTimeout ?? 0;
  }

  /* ------------------------------ registration ---------------------------- */

  /** Register a service from a schema. Returns the live instance. */
  createService(schema: ServiceSchema): Service {
    const service = new Service(this, schema);
    for (const [name, handler] of Object.entries(service.actions)) {
      this.actions.set(`${service.fullName}.${name}`, { service, handler });
    }
    this.services.push(service);
    void service._schema.created?.call(service);
    this.logger.debug("service created", { service: service.fullName });
    return service;
  }

  /** Look up a local service by (versioned) name. */
  getLocalService(name: string): Service | undefined {
    return this.services.find((s) => s.fullName === name || s.name === name);
  }

  /** Remove a service, running its `stopped` hook and unregistering its actions. */
  async destroyService(service: Service): Promise<void> {
    for (const name of Object.keys(service.actions)) {
      this.actions.delete(`${service.fullName}.${name}`);
    }
    const idx = this.services.indexOf(service);
    if (idx !== -1) this.services.splice(idx, 1);
    if (this.started) await service._schema.stopped?.call(service);
  }

  /* ------------------------------- lifecycle ------------------------------ */

  /** Connect the transporter and run every service's `started` hook. */
  async start(): Promise<void> {
    if (this.started) return;
    await this.transporter.connect(this);
    for (const service of this.services) await service._schema.started?.call(service);
    this.started = true;
    this.logger.info("broker started", { nodeID: this.nodeID, services: this.services.length });
  }

  /** Run every service's `stopped` hook (reverse order) and disconnect. */
  async stop(): Promise<void> {
    if (!this.started) return;
    for (const service of [...this.services].reverse()) {
      await service._schema.stopped?.call(service);
    }
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
    if (!endpoint) throw new ServiceNotFoundError(action);

    const ctx = this.makeContext(endpoint.service, action, params, opts.meta ?? {});
    const invoke = Promise.resolve(endpoint.handler(ctx)) as Promise<R>;

    const timeout = opts.timeout ?? this.requestTimeout;
    if (!timeout) return invoke;

    let timer: ReturnType<typeof setTimeout>;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RequestTimeoutError(action, timeout)), timeout);
    });
    try {
      return await Promise.race([invoke, guard]);
    } finally {
      clearTimeout(timer!);
    }
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

  private async dispatch(
    event: string,
    payload: unknown,
    opts: EmitOptions,
    _broadcast: boolean,
  ): Promise<void> {
    // Locally there's a single instance per service, so balanced emit and
    // broadcast reach the same handlers; the distinction matters once a real
    // transporter registers remote instances.
    for (const service of this.services) {
      if (opts.groups && !opts.groups.includes(service.name)) continue;
      for (const [pattern, handler] of Object.entries(service.events)) {
        if (!eventMatches(pattern, event)) continue;
        const ctx = this.makeContext(service, event, payload, opts.meta ?? {});
        await handler(ctx);
      }
    }
  }

  /** True if any registered service listens for the given event. */
  hasEventListener(event: string): boolean {
    return this.services.some((s) =>
      Object.keys(s.events).some((pattern) => eventMatches(pattern, event)),
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
    meta: Record<string, unknown>,
  ): Context {
    const broker = this;
    return {
      params,
      meta,
      broker,
      service,
      name,
      nodeID: broker.nodeID,
      id: broker.generateUid(),
      call: (action, callParams, callOpts = {}) =>
        broker.call(action, callParams, { ...callOpts, meta: { ...meta, ...callOpts.meta } }),
      emit: (ev, evPayload, evOpts = {}) =>
        broker.emit(ev, evPayload, { ...evOpts, meta: { ...meta, ...evOpts.meta } }),
      broadcast: (ev, evPayload, evOpts = {}) =>
        broker.broadcast(ev, evPayload, { ...evOpts, meta: { ...meta, ...evOpts.meta } }),
    };
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
