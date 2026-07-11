// Type-check harness for the validating & caching sections of docs/broker.md.
// Compile-only — never executed.
import { Broker, Cache } from "@shaferllc/keel/core";
import { z } from "zod";

declare function createUser(p: unknown): unknown;
declare function computeDaily(day: string): unknown;

export function validating(broker: Broker) {
  broker.createService({
    name: "users",
    actions: {
      create: {
        params: z.object({ email: z.string().email(), age: z.coerce.number().min(18) }),
        handler: (ctx) => createUser(ctx.params),
      },
    },
  });
}

export function caching(): Broker {
  const broker = new Broker({ cacher: new Cache() });
  broker.createService({
    name: "stats",
    actions: {
      daily: {
        cache: { ttl: 300, keys: ["day"] },
        handler: (ctx: { params: { day: string } }) => computeDaily(ctx.params.day),
      },
      forever: { cache: true, handler: () => 1 },
    },
  });
  return broker;
}
