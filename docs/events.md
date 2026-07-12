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

This is a convenience for the caller: you're passing the same type on both sides
by hand, and nothing checks that you did. Get it wrong in one place and the two
drift apart silently.

## The event registry

Declare an event once in `EventsList` and the emitter checks **both** sides of it
for you — no type argument to remember, and no way for the emitter and the
listener to disagree:

```ts
declare module "@shaferllc/keel/core" {
  interface EventsList {
    "order.paid": { id: number; total: number };
    "user.registered": User;
  }
}
```

Put that in a `types/events.ts` (anywhere the compiler sees it). From then on:

```ts
listen("order.paid", (order) => {
  order.total; // number — inferred from the registry
});

await emit("order.paid", { id: 1, total: 4200 }); // ✅

await emit("order.paid", { id: 1, total: "4200" }); // ❌ total must be a number
await emit("order.paid"); // ❌ this event requires a payload
listen("order.paid", (o: { nope: boolean }) => {}); // ❌ wrong listener payload
```

Declaring events is **opt-in and incremental**. An event you haven't declared
behaves exactly as it always has — the payload type comes from the listener or an
explicit `listen<T>`, and falls back to `unknown` — so you can add entries to
`EventsList` one at a time.

Nothing validates the payload at *runtime*; this is a compile-time contract.

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

**A listener that throws does not stop the others.** `emit()` runs every listener,
then reports what broke. That's the whole point of an emitter: the analytics
listener blowing up shouldn't silently cancel the welcome email.

```ts
listen("user.registered", () => sendWelcomeEmail(user)); // runs
listen("user.registered", () => { throw new Error("boom"); }); // throws
listen("user.registered", () => trackSignup(user)); // still runs

try {
  await emit("user.registered", user);
} catch (err) {
  // every listener ran; err is the failure ("boom")
}
```

Failures are never swallowed. With one failed listener `emit()` rejects with that
error; with several it rejects with an `AggregateError` whose `.errors` holds them
all.

### Handling failures centrally

Register an `onError` handler and `emit()` stops rejecting — each failure goes to
your handler instead, with the event name and the payload that triggered it. This
is how you keep a background listener's bug from taking down the request that
happened to fire the event:

```ts
events().onError((event, error, payload) => {
  logger().error("listener failed", { event, error, payload });
});
```

Firing an event that has no listeners is a no-op — `emit()` resolves immediately.

## Observing every event

`onAny` subscribes to *all* events — for logging, metrics, and other
cross-cutting concerns. It runs before the event's own listeners and returns an
unsubscribe function:

```ts
const off = events().onAny((event, payload) => {
  logger().debug(`event: ${event}`, { payload });
});
```

## Testing

`events().fake()` records emissions **instead of running listeners**, so a test
can assert an event fired without triggering its side effects — no welcome email,
no queued job. It returns a buffer to assert against; `restore()` puts the real
emitter back.

```ts
const buffer = events().fake();

await registerUser({ email: "a@b.com" });

buffer.assertEmitted("user.registered");
buffer.assertEmitted("order.paid", (o) => o.total === 4200); // with a predicate
buffer.assertEmittedCount("user.registered", 1);
buffer.assertNotEmitted("user.deleted");
buffer.assertNoneEmitted(); // nothing at all fired

events().restore();
```

Pass event names to fake only those — everything else dispatches for real:

```ts
const buffer = events().fake("user.registered"); // or ["a", "b"]
```

`buffer.all()` returns every recorded `{ event, payload }` in order, and
`buffer.payloadsFor("order.paid")` returns just that event's payloads (typed, if
the event is declared in `EventsList`).

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
payload. For an event declared in `EventsList`, the payload is required and
type-checked against the registry.

```ts
await events().emit("order.paid", { id: 1, total: 4200 });
```

**Notes:** listeners run sequentially, each awaited before the next. A listener
that throws or rejects **does not** skip the rest — they all run, and `emit`
rejects afterwards with that error (or an `AggregateError` if more than one
failed), unless an `onError` handler is registered. No listeners means an
immediate resolve. Both listener sets are snapshotted up front, so subscriptions
made mid-emit apply only to later emissions.

#### `onAny(listener)`

`onAny(listener: AnyListener): () => void`

Subscribes to every event. The listener receives `(event, payload)`. Returns an
unsubscribe function.

```ts
const off = events().onAny((event, payload) => log(event, payload));
```

**Notes:** any-listeners run *before* the event's own listeners, so a logger sees
the event even if a listener later throws. They're subject to the same error
handling as ordinary listeners.

#### `onError(handler)`

`onError(handler: ErrorHandler): void`

Handles listener failures instead of letting `emit` reject. The handler receives
`(event, error, payload)`.

```ts
events().onError((event, error) => logger().error("listener failed", { event, error }));
```

**Notes:** only one handler is active — registering again replaces it. Without
one, failures surface by rejecting `emit`; they are never silently dropped.

#### `fake(only?)` / `restore()`

`fake(only?: EventName | EventName[]): EventBuffer` — record emissions instead of
running listeners, and return a buffer to assert against. `restore()` undoes it.

```ts
const buffer = events().fake();
await register(user);
buffer.assertEmitted("user.registered");
events().restore();
```

**Notes:** with no argument every event is faked; pass names to fake only those,
leaving the rest to dispatch for real. Each `fake()` returns a **fresh** buffer.

#### `clearAll()`

`clearAll(): void`

Drops every listener, every `onAny` listener, and the error handler. `clear()` only
drops ordinary listeners.

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
rejected promise is treated exactly like a synchronous throw — the other listeners
still run, and the failure is reported afterwards.

#### `EventsList`

`interface EventsList {}`

The registry of declared events, keyed by name. Empty by default; augment it from
your app to type an event's payload (see [The event registry](#the-event-registry)).

```ts
declare module "@shaferllc/keel/core" {
  interface EventsList {
    "order.paid": { id: number; total: number };
  }
}
```

#### `EventBuffer`

What `fake()` returns. Records every intercepted emission and asserts over them.

| Method | Signature |
|--------|-----------|
| `assertEmitted` | `(event, predicate?) => void` |
| `assertNotEmitted` | `(event) => void` |
| `assertEmittedCount` | `(event, count) => void` |
| `assertNoneEmitted` | `() => void` |
| `all` | `() => RecordedEvent[]` |
| `payloadsFor` | `(event) => PayloadOf<E>[]` |

Failed assertions throw with what actually fired.

#### `AnyListener`

`type AnyListener = (event: string, payload: unknown) => void | Promise<void>`

The shape of an `onAny` handler.

#### `ErrorHandler`

`type ErrorHandler = (event: string, error: unknown, payload: unknown) => void | Promise<void>`

The shape of an `onError` handler.

#### `RecordedEvent`

`interface RecordedEvent { event: string; payload: unknown }`

One emission captured by a fake.

#### `EventName` / `PayloadOf`

`type EventName = keyof EventsList | (string & {})` — a declared event name, or any
other string.

`type PayloadOf<E>` — the declared payload for an event, or `unknown` if it isn't in
`EventsList`.
