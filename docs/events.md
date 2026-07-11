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

## Typed payloads

Both `emit` and `listen` take a payload type parameter, so the value you fire and
the value your listener receives line up at compile time:

```ts
type OrderPaid = { id: number; total: number };

listen<OrderPaid>("order.paid", (order) => {
  order.total; // number
});

await emit<OrderPaid>("order.paid", { id: 1, total: 4200 });
```

The type is a convenience for the caller — nothing validates the payload at
runtime, and the emitter keys listeners only by the event string. Pass the same
type on both sides and they stay in sync; the emitter won't enforce it for you.

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

`boot()` runs after every provider has registered, so it's safe to resolve other
services there. Don't register listeners in `register()` — the services they
reach may not be bound yet.

## The full API

Reach the emitter directly with `events()` for `once`, `off`, and more:

```ts
import { events } from "@shaferllc/keel/core";

events().once("boot", () => {});      // fire once, then auto-unsubscribe
events().off("tick", listener);
events().listenerCount("tick");
events().clear("tick");                // or clear() for everything
```

## Ordering and awaiting

Listeners for an event run in registration order, and `emit()` **awaits** each
one before starting the next — so a slow async listener finishes before the
following listener begins, and before `emit()` resolves:

```ts
listen("deploy", async () => { await step1(); });
listen("deploy", async () => { await step2(); }); // runs after step1 settles

await emit("deploy"); // resolves only after both steps finish
```

`emit()` snapshots the listener set before iterating, so a listener that
subscribes (or unsubscribes) another during the same `emit()` doesn't change who
runs this time around — the change takes effect on the next emission.

## Error behavior

`emit()` awaits listeners in sequence with no `try/catch`, so if a listener
throws (or rejects), the loop stops there: later listeners don't run and the
`emit()` promise rejects with that error.

```ts
try {
  await emit("user.registered", user);
} catch (err) {
  // a listener threw — subsequent listeners were skipped
}
```

If a listener's failure shouldn't halt the chain, catch inside the listener
itself. Firing an event that has no listeners is a no-op — `emit()` resolves
immediately.

## Notes

- A listener is stored once per event (the backing store is a `Set`), so
  registering the exact same function twice for the same event only fires it
  once. Register a fresh function each time if you want it to run twice.
- Events are in-process. For cross-process or durable events, have a listener
  publish to your queue/broker of choice.

---

## API reference

### `Events`

The emitter itself — a container singleton. You rarely construct it; resolve it
with `events()` (or `app().make(Events)`). Events are keyed by string; each key
holds a `Set` of listeners.

#### `on(event, listener)`

`on<T = unknown>(event: string, listener: Listener<T>): () => void`

Subscribes `listener` to `event` and returns an unsubscribe function.

```ts
const off = events().on<{ id: number }>("user.deleted", (u) => audit(u.id));
off(); // later: stop listening
```

**Notes:** the returned function removes exactly this listener. The same function
reference is de-duplicated per event (Set-backed), so subscribing it twice still
only registers — and fires — it once. The global `listen()` helper is a thin
wrapper over this.

#### `once(event, listener)`

`once<T = unknown>(event: string, listener: Listener<T>): () => void`

Subscribes for a single emission: the listener runs on the next `emit`, then
auto-unsubscribes. Also returns an unsubscribe function to cancel it beforehand.

```ts
events().once("boot", () => console.log("started"));
```

**Notes:** it unsubscribes itself *before* awaiting your callback, so a listener
that re-emits the same event won't re-trigger this one. The returned unsubscribe
removes the internal wrapper, so it works even if the event never fires.

#### `off(event, listener)`

`off<T = unknown>(event: string, listener: Listener<T>): void`

Removes `listener` from `event`. No-op if it wasn't subscribed.

```ts
events().off("tick", handler);
```

**Notes:** you must pass the same function reference you subscribed with —
anonymous inline functions can't be removed this way, so keep a reference (or use
the unsubscribe function `on`/`once` return). Removing the last listener leaves an
empty `Set` behind under that key; use `clear(event)` to drop the key entirely.

#### `emit(event, payload?)`

`emit<T = unknown>(event: string, payload?: T): Promise<void>`

Fires `event`, awaiting every listener in registration order with the given
payload.

```ts
await events().emit("order.paid", { id: 1, total: 4200 });
```

**Notes:** listeners run sequentially, each awaited before the next. If one
throws/rejects, the remaining listeners are skipped and the promise rejects. No
listeners means an immediate resolve. The listener set is snapshotted up front, so
subscriptions made mid-emit apply only to later emissions.

#### `listenerCount(event)`

`listenerCount(event: string): number`

Returns how many listeners are currently subscribed to `event`.

```ts
if (events().listenerCount("tick") === 0) startClock();
```

**Notes:** returns `0` for an unknown event.

#### `clear(event?)`

`clear(event?: string): void`

Removes all listeners for `event`, or — with no argument — every listener for
every event.

```ts
events().clear("tick"); // drop one event's listeners
events().clear();        // wipe everything (handy between tests)
```

**Notes:** unlike `off`, this deletes the event's key outright, so it also cleans
up the empty-`Set` residue `off` can leave behind.

### Global helpers

Convenience functions that resolve the active application's `Events` singleton —
no need to thread the container around.

#### `events()`

`events(): Events`

Returns the application's `Events` instance.

```ts
import { events } from "@shaferllc/keel/core";
events().once("boot", () => {});
```

**Notes:** resolves `Events` from the active application container, so every call
returns the same singleton. Throws `No Keel application has been bootstrapped…`
if no `Application` has been created yet.

#### `emit(event, payload?)`

`emit<T = unknown>(event: string, payload?: T): Promise<void>`

Shorthand for `events().emit(event, payload)` — fire an event from anywhere.

```ts
import { emit } from "@shaferllc/keel/core";
await emit("user.registered", user);
```

**Notes:** same awaiting/error semantics as `Events.emit`. Requires a bootstrapped
application.

#### `listen(event, listener)`

`listen<T = unknown>(event: string, listener: Listener<T>): () => void`

Shorthand for `events().on(event, listener)` — subscribe from anywhere; returns an
unsubscribe function.

```ts
import { listen } from "@shaferllc/keel/core";
const off = listen<{ id: number }>("user.deleted", (u) => audit(u.id));
```

**Notes:** wraps `on`, not `once`, so the listener stays subscribed until you call
the returned function. Requires a bootstrapped application.

### Interfaces & types

#### `Listener`

`type Listener<T = unknown> = (payload: T) => void | Promise<void>`

The shape of an event handler: a function taking the payload, optionally async.
Use it to type a handler you store or pass around before subscribing.

```ts
import { type Listener } from "@shaferllc/keel/core";

const onPaid: Listener<{ id: number }> = async (order) => {
  await fulfill(order.id);
};
listen("order.paid", onPaid);
```

**Notes:** async listeners are fully awaited by `emit`. A listener that returns a
rejected promise halts the current `emit` just like a synchronous throw.
