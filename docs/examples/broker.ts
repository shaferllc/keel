// Type-check harness for docs/broker.md. Compile-only — never executed.
import {
  Broker,
  setBroker,
  broker,
  type Context,
  type Transporter,
} from "@shaferllc/keel/core";

export function defineService() {
  broker().createService({
    name: "users",
    settings: { defaultRole: "member" },
    metadata: { region: "us-east" },
    actions: {
      async get(this: any, ctx: Context<{ id: number }>) {
        return { id: ctx.params.id, role: this.settings.defaultRole };
      },
      async create(ctx: Context<{ email: string }>) {
        const user = { id: 1, email: ctx.params.email };
        await ctx.emit("user.created", user);
        return user;
      },
    },
    events: {
      "user.created": (_ctx: Context) => {},
    },
  });
}

export async function calling() {
  await broker().call("users.create", { email: "ada@keel.dev" });
  await broker().call("users.get", { id: 1 }, { meta: { locale: "en" } });
  await broker().call("reports.build", {}, { timeout: 5000 });

  const [a, b] = await broker().mcall<[unknown, unknown]>([
    { action: "users.get", params: { id: 1 } },
    { action: "users.get", params: { id: 2 } },
  ]);
  const { profile, posts } = await broker().mcall<{ profile: unknown; posts: unknown }>({
    profile: { action: "users.get", params: { id: 1 } },
    posts: { action: "posts.byUser", params: { id: 1 } },
  });
  return { a, b, profile, posts };
}

export async function contextSlots() {
  await broker().call("reports.build", {}, {
    headers: { "x-trace": "abc" },
    requestID: "req-42",
  });
}

export function contextTree() {
  broker().createService({
    name: "orders",
    actions: {
      place(ctx: Context) {
        void ctx.id;
        void ctx.parentID;
        void ctx.level;
        void ctx.caller;
        void ctx.action?.name;
        void ctx.toJSON();
        return ctx.call("orders.notify");
      },
      notify: (_ctx: Context) => {},
    },
    events: {
      "order.placed": (ctx: Context) => {
        void ctx.eventName;
        void ctx.eventType;
        void ctx.eventGroups;
      },
    },
  });
}

export async function events() {
  await broker().emit("user.created", { id: 1 });
  await broker().emit("user.created", { id: 1 }, { groups: ["notify"] });
  await broker().broadcast("cache.flush");
  await broker().broadcastLocal("cache.warm");
  broker().hasEventListener("user.created");

  broker().createService({
    name: "mailer",
    events: { "user.created": { group: "notify", handler: (_ctx: Context) => {} } },
  });

  broker().createService({
    name: "registry",
    events: {
      "user.??eated": (_ctx: Context) => {},
      "$services.changed": (ctx: Context) => void (ctx.params as { service: string }).service,
      "$broker.started": (_ctx: Context) => {},
      "$broker.stopped": (_ctx: Context) => {},
    },
  });
}

export function fullActionDefs() {
  broker().createService({
    name: "billing",
    actions: {
      quote: (_ctx: Context) => ({ cents: 999 }),
      charge: {
        visibility: "private",
        timeout: 3000,
        hooks: {
          before: (_ctx) => {},
          after: (_ctx, res) => res,
        },
        handler: (ctx: Context<{ cents: number }>) => ctx.params.cents,
      },
      checkout(this: any, ctx: Context<{ cents: number }>) {
        return this.actions.charge({ cents: ctx.params.cents });
      },
    },
  });
}

export function serviceHooks() {
  broker().createService({
    name: "users",
    hooks: {
      before: {
        "*": (_ctx) => {},
        "create|update": (_ctx) => {},
        remove: (_ctx) => {},
      },
      after: {
        get: (_ctx, res: any) => ({ ...res, fetchedAt: Date.now() }),
      },
      error: {
        "*": (_ctx, err) => {
          throw err;
        },
      },
    },
    actions: {
      get: (_ctx: Context) => ({}),
      create: (_ctx: Context) => ({}),
      update: (_ctx: Context) => ({}),
      remove: (_ctx: Context) => ({}),
    },
  });
}

const Timestamps = {
  name: "timestamps",
  settings: { softDelete: false },
  methods: {
    touch(this: any) {},
  },
};

export function mixins() {
  broker().createService({
    mixins: [Timestamps],
    name: "articles",
    settings: { perPage: 10 },
    actions: { list: () => [] },
    merged(schema) {
      void schema.name;
    },
  });
}

export function dependencies() {
  broker().createService({
    name: "api",
    dependencies: ["db", "cache"],
    async started(this: any) {
      await this.waitForServices("mailer", 5000);
    },
  });
}

export async function lifecycleAndCluster() {
  const b = broker();
  b.createService({
    name: "clock",
    async started(this: any) {
      this.timer = setInterval(() => this.broker.broadcast("tick"), 1000);
    },
    async stopped(this: any) {
      clearInterval(this.timer);
    },
  });
  await b.start();
  await b.stop();

  await broker().emit("user.created", { id: 1 });
  await broker().broadcast("cache.flush");
  broker().hasEventListener("user.created");

  const nats: Transporter = {
    async connect(_broker) {},
    async disconnect() {},
  };
  setBroker(new Broker({ nodeID: "api-1", transporter: nats, requestTimeout: 10_000 }));
}
