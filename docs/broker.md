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
to the live service, so they can reach `this.settings`, `this.broker`,
`this.logger`, and any `methods` you define.

```ts
import { broker, type Context } from "@shaferllc/keel/core";

broker().createService({
  name: "users",
  settings: { defaultRole: "member" },
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
carries the current `meta` (and trace id) into the child call automatically.

## Events

`emit` sends a **balanced** event — each listening service receives it once. In a
cluster only one instance per service group is chosen; locally, with one instance
per service, that's every listener. `broadcast` always reaches every listener.
Subscription keys may glob: `user.*` matches one segment, `user.**` any depth.

```ts
await broker().emit("user.created", user);        // balanced
await broker().broadcast("cache.flush");          // everyone
broker().hasEventListener("user.created");         // boolean
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
