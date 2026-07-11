// Type-check harness for the fault-tolerance & registry sections of
// docs/broker.md. Compile-only — never executed.
import { Broker } from "@shaferllc/keel/core";

declare const id: string;
declare const cart: unknown;

export async function faultTolerance(broker: Broker) {
  await broker.call("orders.get", { id }, {
    retries: 3,
    fallback: { id, status: "unknown" },
  });
  await broker.call("pricing.quote", cart, {
    timeout: 500,
    fallback: (err: Error) => ({ error: err.message, price: null }),
  });
}

export function defaults(): Broker {
  return new Broker({ requestTimeout: 1000, retries: 2 });
}

export function introspection(broker: Broker) {
  const has: boolean = broker.hasAction("users.find");
  const actions: string[] = broker.listActions();
  const services: string[] = broker.listServices();
  const svc = broker.getService("users");
  return { has, actions, services, name: svc?.name };
}
