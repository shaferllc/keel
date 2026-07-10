# Events

A tiny event emitter for decoupling — fire an event in one place, handle it in
another. The emitter is a container singleton, reachable through the global
`emit()` / `listen()` helpers.

## Listen and emit

```ts
import { emit, listen } from "@shaferllc/keel/core";

// register a listener (usually in a provider's boot())
listen("user.registered", (user) => {
  sendWelcomeEmail(user);
});

// fire it from anywhere — emit awaits every listener
await emit("user.registered", user);
```

`listen()` returns an unsubscribe function:

```ts
const off = listen("tick", () => {});
off(); // stop listening
```

## Where to register listeners

Register listeners in a service provider's `boot()` method, so they're wired up
once when the app starts:

```ts
export class EventServiceProvider extends ServiceProvider {
  boot(): void {
    listen("order.paid", (order) => this.app.make(Fulfillment).ship(order));
  }
}
```

## The full API

Reach the emitter directly with `events()` for `once`, `off`, and more:

```ts
import { events } from "@shaferllc/keel/core";

events().once("boot", () => {});      // fire once, then auto-unsubscribe
events().off("tick", listener);
events().listenerCount("tick");
events().clear("tick");                // or clear() for everything
```

## Notes

- Listeners run in registration order, and `emit()` **awaits** each one — so an
  async listener finishes before the next runs, and before `emit()` resolves.
- Events are in-process. For cross-process or durable events, have a listener
  publish to your queue/broker of choice.
