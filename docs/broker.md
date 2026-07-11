# Service Broker

Structure an application as **services** that talk to each other by name instead
of by import. You register a service — a name plus a bag of `actions` and
`events` — with a **broker**, then reach it anywhere with
`broker.call("users.get", { id })` or fan an event out with
`broker.emit("user.created", user)`. It's a [Moleculer](https://moleculer.services/docs/0.15/broker)-style
backbone: actions receive a `Context` and can call *other* actions through it, so
a request threads its `meta` (auth, trace ids) all the way down.

Like the queue and Redis layers, clustering lives behind a pluggable seam. The
default `LocalTransporter` is a single-node no-op, so the core imports no network
client and runs on Node and the edge. Swap in a real `Transporter` to span
processes — the `call` / `emit` API never changes.

## Defining a service

A service is a schema object. Handlers and lifecycle hooks run with `this` bound
to the live service, so they can reach `this.settings`, `this.metadata`,
`this.broker`, `this.logger`, and any `methods` you define.

```ts
import { broker, type Context } from "@shaferllc/keel/core";

broker().createService({
  name: "users",
  settings: { defaultRole: "member" },
  metadata: { region: "us-east" }, // descriptive; travels with discovery
  actions: {
    async get(this: any, ctx: Context<{ id: number }>) {
      return { id: ctx.params.id, role: this.settings.defaultRole };
    },
    async create(ctx: Context<{ email: string }>) {
      const user = { id: 1, email: ctx.params.email };
      await ctx.emit("user.created", user); // inherits ctx.meta
      return user;
    },
  },
  events: {
    "user.created": (ctx: Context) => {
      // ctx.params is the event payload
    },
  },
});
```

## Calling actions

An action is addressed as `"<service>.<action>"`. Give a service a `version` and
its actions namespace under a `v`-prefix (`v2.users.get`).

```ts
const user = await broker().call("users.create", { email: "ada@keel.dev" });

// pass metadata that flows down through nested ctx.call()s
await broker().call("users.get", { id: 1 }, { meta: { locale: "en" } });

// bound a call with a timeout (ms); rejects with RequestTimeoutError
await broker().call("reports.build", {}, { timeout: 5000 });
```

Inside an action, use `ctx.call(...)` rather than `broker().call(...)` — it
carries the current `meta` (and `requestID`) into the child call automatically.

Call several actions at once with `mcall` — pass an array or a keyed map and get
the same shape back. With `settled: true` you get a per-call
`{ status, value | reason }` instead of failing on the first rejection.

```ts
const [a, b] = await broker().mcall([
  { action: "users.get", params: { id: 1 } },
  { action: "users.get", params: { id: 2 } },
]);

const { profile, posts } = await broker().mcall({
  profile: { action: "users.get", params: { id: 1 } },
  posts: { action: "posts.byUser", params: { id: 1 } },
});
```

### The call context

Every handler receives a `Context`. Beyond `params`, `meta`, and `call`, it
carries a few request-scoped slots:

- **`ctx.meta`** — flows *down* into nested `ctx.call()`s. Put auth, locale, and
  trace data here.
- **`ctx.headers`** — per-call and **transient**: available to this handler and
  its hooks, but *not* propagated to nested calls.
- **`ctx.locals`** — scratch space shared between a call's hooks and its handler
  (e.g. a hook looks up the current user, the handler reads it back).
- **`ctx.requestID`** — one correlation id for the whole request tree; generated
  once and threaded through every nested call. Pass your own to stitch a call
  into an existing trace.

```ts
await broker().call("reports.build", {}, {
  headers: { "x-trace": "abc" },
  requestID: "req-42",
});
```

Each `ctx.call()` builds a child context linked to its parent, so a handler can
see where it sits in the request tree:

- **`ctx.id`** — unique per context; **`ctx.parentID`** — the caller's `id`
  (`null` at the root).
- **`ctx.level`** — call depth, `1` at the root and `+1` per nested call.
- **`ctx.caller`** — the full name of the service that invoked this call (`null`
  at the root).
- **`ctx.action`** — `{ name }` of the running action (absent in event handlers).
- **`ctx.toJSON()`** — a serializable snapshot (ids, level, caller, name, meta) —
  no functions or live `broker`/`service` refs, so it is safe to log.

In an **event** handler the context instead carries **`ctx.eventName`**,
**`ctx.eventType`** (`"emit"` or `"broadcast"`), and **`ctx.eventGroups`**.

## Full action definitions

An action is a bare handler by default. Swap in an object to attach per-action
options — `visibility`, a `timeout`, and `hooks`:

```ts
broker().createService({
  name: "billing",
  actions: {
    // shorthand — a plain handler
    quote: (ctx: Context) => ({ cents: 999 }),

    // full form
    charge: {
      visibility: "private",   // hidden from broker.call — internal only
      timeout: 3000,           // per-action; the call option still overrides it
      hooks: {
        before: (ctx) => { /* validate */ },
        after: (ctx, res) => res,
      },
      handler: (ctx: Context<{ cents: number }>) => ctx.params.cents,
    },
  },
});
```

### Visibility

`visibility` controls how far an action reaches:

| Value                    | Reachable via `broker.call` / `ctx.call` | Internally (`this.actions.x`) |
| ------------------------ | ---------------------------------------- | ----------------------------- |
| `published` *(default)*  | yes                                      | yes                           |
| `public`                 | yes                                      | yes                           |
| `protected`              | yes (same node)                          | yes                           |
| `private`                | **no** — throws `ServiceNotFoundError`   | yes                           |

A `private` action is invisible to `call`, but a service can still invoke its
own private actions through `this.actions.<name>(params)`, which runs the full
pipeline (hooks and timeout) while skipping the visibility gate.

```ts
actions: {
  charge: { visibility: "private", handler: (ctx) => /* ... */ },
  checkout(this: any, ctx: Context) {
    return this.actions.charge({ cents: ctx.params.cents }); // ok — internal
  },
}
```

## Hooks

Hooks wrap action handlers to keep validation, sanitisation, and response
shaping out of the handler body. Declare them at the **service** level (keyed by
action name) or inline on a single **action**.

```ts
broker().createService({
  name: "users",
  hooks: {
    before: {
      "*": (ctx) => { /* runs before every action */ },
      "create|update": (ctx) => { /* pipe list */ },
      remove: (ctx) => { /* exact name */ },
    },
    after: {
      get: (ctx, res) => ({ ...res, fetchedAt: Date.now() }), // must return res
    },
    error: {
      "*": (ctx, err) => { throw err; }, // return a fallback, or re-throw
    },
  },
  actions: { /* ... */ },
});
```

- **before** hooks receive `ctx` and may mutate `ctx.params`, `ctx.meta`, and
  `ctx.locals`. Their return value is ignored — they can't skip the handler.
- **after** hooks receive `(ctx, res)` and **must return** the (possibly
  transformed) response.
- **error** hooks receive `(ctx, err)`. Return a value to recover, or throw to
  propagate. If several match, each re-throw feeds the next.

Keys may be `"*"` (all actions), an exact name, a `"a|b"` pipe list, or a `*`
glob (`"get*"`). Ordering matches Moleculer — **before** runs service-wildcard →
service-named → action, and **after**/**error** run in reverse (action →
service-named → service-wildcard):

```
before:  hooks.before["*"]  →  hooks.before[name]  →  action.hooks.before  →  handler
after:   action.hooks.after →  hooks.after[name]   →  hooks.after["*"]
```

## Mixins

`mixins` fold reusable schemas into a service. Every field is merged by type —
`settings`/`metadata` deep-merge, `actions`/`events`/`methods`/`hooks` merge by
key, and lifecycle hooks (`created`/`started`/`stopped`/`merged`) *chain* so all
of them run (mixins first, then the service). **The service's own schema always
wins on conflict.**

```ts
const Timestamps = {
  name: "timestamps",
  settings: { softDelete: false },
  methods: { touch(this: any) { /* ... */ } },
};

broker().createService({
  mixins: [Timestamps],
  name: "articles",
  settings: { perPage: 10 },        // → { softDelete: false, perPage: 10 }
  actions: { list: () => [] },
  merged(schema) {
    // fires once, after mixins merge, before the instance is built
  },
});
```

When several mixins collide, the **first** in the array wins.

## Dependencies

List services a service needs with `dependencies`. During `broker.start()`, a
service's `started` hook waits until every dependency is registered. You can also
await readiness directly with `waitForServices` (from the broker or `this`):

```ts
broker().createService({
  name: "api",
  dependencies: ["db", "cache"], // started() waits for both
  async started() {
    await this.waitForServices("mailer", 5000); // optional explicit wait (ms)
  },
});
```

## Events

`emit` sends a **balanced** event — each listening *group* receives it once. In a
cluster only one instance per group is chosen; locally, with one instance per
service, that's every listener. `broadcast` always reaches every listener, and
`broadcastLocal` reaches every listener on this node (identical to `broadcast`
until a real transporter would otherwise relay across nodes).

```ts
await broker().emit("user.created", user);        // balanced
await broker().broadcast("cache.flush");          // everyone
await broker().broadcastLocal("cache.warm");      // everyone on this node
broker().hasEventListener("user.created");         // boolean
```

### Groups

Every listener belongs to a **group** — its service name by default, or whatever
`group` you set on the listener. `emit` delivers to one listener per group; pass
`groups` to target specific ones:

```ts
broker().createService({
  name: "mailer",
  events: { "user.created": { group: "notify", handler: (ctx) => {} } },
});

await broker().emit("user.created", user, { groups: ["notify"] });
```

### Patterns

Subscription keys may glob: `*` matches one segment (`user.*`), `**` any depth
(`user.**`), and `?` a single non-dot character (`user.??eated`).

### Internal events

The broker emits its own lifecycle events, which any service can subscribe to:

- **`$broker.started`** / **`$broker.stopped`** — after `start()` / before `stop()`.
- **`$services.changed`** — when a service is created or destroyed; the payload is
  `{ service }`.

```ts
broker().createService({
  name: "registry",
  events: {
    "$services.changed": (ctx) => {
      // ctx.params.service changed
    },
  },
});
```

## Lifecycle

Nothing runs actions across the network until you `start()`. Hooks fire in order:
`created` when the service is registered, `started` on `broker.start()`, and
`stopped` on `broker.stop()` (reverse order).

```ts
const b = broker();
b.createService({
  name: "clock",
  async started() {
    this.timer = setInterval(() => this.broker.broadcast("tick"), 1000);
  },
  async stopped() {
    clearInterval(this.timer);
  },
});

await b.start();
// ...
await b.stop();
```

## Clustering

The default broker is single-node. To span processes, implement `Transporter`
and pass it in — the broker calls `connect` on start and `disconnect` on stop,
and a real transporter registers remote services and relays calls/events:

```ts
import { Broker, setBroker, type Transporter } from "@shaferllc/keel/core";

const nats: Transporter = {
  async connect(broker) {
    /* subscribe, register remote endpoints */
  },
  async disconnect() {
    /* close */
  },
};

setBroker(new Broker({ nodeID: "api-1", transporter: nats, requestTimeout: 10_000 }));
```

`broker()` returns the default instance (a fresh single-node `Broker`);
`setBroker()` replaces it, exactly as `redis()` / `setRedis()` work.

## Middlewares

Broker middlewares wrap every action call and tap broker lifecycle — the place
for cross-cutting concerns (logging, metrics, caching, auth) that apply to all
services. A middleware's `localAction` receives the next handler and returns a
replacement, so they compose (the first in the array is the outermost):

```ts
import { Broker, type BrokerMiddleware } from "@shaferllc/keel/core";

const timing: BrokerMiddleware = {
  name: "timing",
  localAction(next, action) {
    return async (ctx) => {
      const start = performance.now();
      try {
        return await next(ctx);
      } finally {
        logger().debug("action", { action, ms: performance.now() - start });
      }
    };
  },
  started(broker) {
    logger().info("broker up", { nodeID: broker.nodeID });
  },
  stopped() {
    /* flush metrics, close connections */
  },
};

const broker = new Broker({ middlewares: [timing] });
```

`localAction(next, action)` wraps the handler (action = the full action name);
`started(broker)` / `stopped(broker)` run during `broker.start()` / `stop()`
(stopped in reverse order). A middleware that omits `localAction` leaves calls
untouched — handy for a lifecycle-only middleware.

## Fault tolerance

A call can be made resilient with per-call options (or broker-wide defaults):

```ts
// retry up to 3 times, then fall back to a cached value
await broker.call("orders.get", { id }, {
  retries: 3,
  fallback: { id, status: "unknown" },
});

// timeout + a computed fallback
await broker.call("pricing.quote", cart, {
  timeout: 500,
  fallback: (err: Error) => ({ error: err.message, price: null }),
});

const broker = new Broker({ requestTimeout: 1000, retries: 2 }); // defaults for every call
```

- **`retries`** — total attempts are `retries + 1`; the whole call re-runs on
  failure. Defaults to `BrokerOptions.retries`.
- **`fallback`** — a value, or `(err, ctx) => value`, returned once every attempt
  (and any `error` hooks) has failed — instead of throwing.
- **`timeout`** — ms before a `RequestTimeoutError` (per call, per action, or the
  broker default).

Order: retry → error hooks → fallback → throw.

## Registry introspection

The broker's registry is queryable:

```ts
broker.hasAction("users.find"); // boolean (private actions read as absent)
broker.listActions();           // ["orders.get", "users.find", …] (public, sorted)
broker.listServices();          // ["orders", "users", …]
broker.getService("users");     // the Service instance, or undefined
```

## Networking & balancing

The broker is **single-node** by default (`LocalTransporter`). Clustering across
nodes is the `Transporter` seam — implement `Transporter` for NATS, Redis, or TCP
and pass it as `transporter`. With a single node there's one endpoint per action,
so cross-node **load balancing** doesn't apply; event **group** balancing (one
listener per group) works today via `emit(event, payload, { groups })`.

## Validating params

Give an action a `params` schema and it's validated (and coerced) before the
handler runs — a bad call rejects with a `ValidationException`, so the handler
only ever sees valid input:

```ts
import { z } from "zod";

broker.createService({
  name: "users",
  actions: {
    create: {
      params: z.object({ email: z.string().email(), age: z.coerce.number().min(18) }),
      handler: (ctx) => createUser(ctx.params), // params typed + validated
    },
  },
});
```

Any [Zod-style schema](./validation.md) works — the broker bundles no validator.

## Caching action results

Mark an action `cache` and give the broker a `cacher` (any Keel [`Cache`](./cache.md)
— memory, or Redis via `redisStore()`), and results are memoized by action + params:

```ts
import { Cache } from "@shaferllc/keel/core";

const broker = new Broker({ cacher: new Cache() });

broker.createService({
  name: "stats",
  actions: {
    daily: {
      cache: { ttl: 300, keys: ["day"] }, // 5 min; key on the `day` param only
      handler: (ctx) => computeDaily(ctx.params.day),
    },
  },
});
```

`cache: true` caches forever keyed on all params; `{ ttl }` sets a TTL (seconds);
`{ keys }` limits the cache key to those params. With no `cacher`, `cache` is a
no-op.

## Metrics, tracing, errors & runner

- **Metrics & tracing** — the [middleware](#middlewares) `localAction` seam is the
  hook: wrap every call to time it, count it, or open a span. Every context
  already carries the trace fields (`ctx.requestID`, `ctx.parentID`, `ctx.level`,
  `ctx.caller`) a span exporter needs.
- **Errors** — the broker throws typed errors (`ServiceNotFoundError`,
  `RequestTimeoutError`, and `ValidationException` from `params`); define your own
  with [`createError`](./errors.md).
- **Runner** — no separate runner binary: register services with `createService()`
  (loop over a folder of schemas) and call `broker.start()` from your app's boot
  or a [service provider](./providers.md).
