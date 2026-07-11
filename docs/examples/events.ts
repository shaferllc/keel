// Type-check harness for docs/events.md. Every type-checkable snippet in the
// reference is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import {
  emit,
  listen,
  events,
  Events,
  ServiceProvider,
  type Listener,
} from "@shaferllc/keel/core";

declare const user: { id: number };
declare function sendWelcomeEmail(u: unknown): void;
declare function step1(): Promise<void>;
declare function step2(): Promise<void>;
declare function audit(id: number): void;
declare function fulfill(id: number): Promise<void>;
declare const handler: Listener;
declare const listener: Listener;
declare class Fulfillment {
  ship(order: unknown): void;
}

export async function listenAndEmit() {
  listen("user.registered", (u) => {
    sendWelcomeEmail(u);
  });
  await emit("user.registered", user);

  const off = listen("tick", () => {});
  off();
}

export async function typedPayloads() {
  type OrderPaid = { id: number; total: number };

  listen<OrderPaid>("order.paid", (order) => {
    order.total; // number
  });

  await emit<OrderPaid>("order.paid", { id: 1, total: 4200 });
}

export class EventServiceProvider extends ServiceProvider {
  boot(): void {
    listen("order.paid", (order) => this.app.make(Fulfillment).ship(order));
  }
}

export function fullApi() {
  events().once("boot", () => {});
  events().off("tick", listener);
  events().listenerCount("tick");
  events().clear("tick");
  events().clear();
}

export async function orderingAndAwaiting() {
  listen("deploy", async () => { await step1(); });
  listen("deploy", async () => { await step2(); });
  await emit("deploy");
}

export async function errorBehavior() {
  try {
    await emit("user.registered", user);
  } catch (err) {
    void err;
  }
}

// --- Events methods ---

export function eventsOn() {
  const off = events().on<{ id: number }>("user.deleted", (u) => audit(u.id));
  off();
}

export function eventsOnce() {
  events().once("boot", () => console.log("started"));
}

export function eventsOff() {
  events().off("tick", handler);
}

export async function eventsEmit() {
  await events().emit("order.paid", { id: 1, total: 4200 });
}

export function eventsListenerCount() {
  if (events().listenerCount("tick") === 0) {
    /* startClock() */
  }
}

export function eventsClear() {
  events().clear("tick");
  events().clear();
}

// --- Global helpers ---

export function helperEvents() {
  events().once("boot", () => {});
}

export async function helperEmit() {
  await emit("user.registered", user);
}

export function helperListen() {
  const off = listen<{ id: number }>("user.deleted", (u) => audit(u.id));
  return off;
}

// --- Interfaces & types ---

const onPaid: Listener<{ id: number }> = async (order) => {
  await fulfill(order.id);
};
listen("order.paid", onPaid);

// The Events class is resolved via events(); referenced here for completeness.
export type EventsType = Events;
