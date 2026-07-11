# Notifications

Send a message to a recipient over one or more **channels** — mail, database, or
your own — inline or through the queue. This is where the mail and queue layers
compose: a notification declares *what* to say and *which channels* carry it,
and each channel decides *how*. Edge-safe, like everything under it.

## Defining a notification

Subclass `Notification`. `via()` lists the channels; each channel reads from a
matching method (`toMail`, `toArray`):

```ts
import { Notification, type Notifiable, type MailContent } from "@shaferllc/keel/core";

export class InvoicePaid extends Notification {
  constructor(private amount: number) {
    super();
  }
  via(_notifiable: Notifiable) {
    return ["mail", "database"];
  }
  toMail(): MailContent {
    return { subject: "Payment received", text: `Thanks for $${this.amount}.` };
  }
  toArray() {
    return { amount: this.amount };
  }
}
```

Generate one with `keel make:notification InvoicePaid` (→
`app/Notifications/InvoicePaidNotification.ts`).

## Sending

```ts
import { notify } from "@shaferllc/keel/core";

await notify(user, new InvoicePaid(4200));          // one recipient
await notify([alice, bob], new InvoicePaid(4200));  // many
```

A recipient is any object with routing info — usually a `User` model. The mail
channel routes to `notifiable.email`; override per channel with
`routeNotificationFor`:

```ts
class User extends Model {
  static table = "users";
  routeNotificationFor(channel: string) {
    return channel === "mail" ? this.billing_email : undefined;
  }
}
```

## Routing

Each channel needs to know *where* a recipient receives it. `routeFor` resolves
that: it calls the notifiable's `routeNotificationFor(channel)` first, and if
that returns nothing it falls back to `notifiable.email` for the `mail` channel
or `notifiable.id` for everything else.

```ts
import { routeFor } from "@shaferllc/keel/core";

routeFor(user, "mail");     // user.email, unless routeNotificationFor overrides it
routeFor(user, "database"); // user.id
```

So the common case needs no routing method at all — a `User` with `email` and
`id` columns just works. Override `routeNotificationFor` only when a channel
addresses the recipient differently (a billing address, a Slack id, a phone
number). Return `undefined` from it to fall back to the default.

The mail channel throws `Notification: no mail route …` if it can't resolve an
address — set `email`, implement `routeNotificationFor`, or put a `to` on the
`MailContent`.

## Channels

Register channels on the notifier (typically in a service provider). The `mail`
channel is registered by default:

```ts
import { setNotifier, Notifier, DatabaseChannel } from "@shaferllc/keel/core";

setNotifier(new Notifier().channel("database", new DatabaseChannel()));
```

| Channel | Delivers by |
|---------|-------------|
| `MailChannel` (`mail`, default) | The mailer, using the notification's `toMail`. Routes to `email`. |
| `DatabaseChannel` (`database`) | Inserting `toArray` into a table (`type`, `notifiable_id`, `data`). |
| `ArrayChannel` (`array`) | Collecting deliveries in `.sent` — for tests. |

The database channel expects a table (default `notifications`) with `type`,
`notifiable_id`, and a `data` (JSON) column — create it in a migration. Point it
at another table by passing the name: `new DatabaseChannel("alerts")`.

Delivery walks the channels named by `via()` in order, and each is looked up by
name. If `via()` names a channel that was never registered, the notifier throws
`No notification channel "…" registered.` — so register a channel before a
notification routes to it. Likewise the mail channel throws if the notification
has no `toMail()`.

## Queued notifications

Set `shouldQueue = true` and delivery happens from a queued job instead of on
the request path — every channel runs inside the job:

```ts
export class InvoicePaid extends Notification {
  shouldQueue = true;
  // …
}

await notify(user, new InvoicePaid(4200)); // returns immediately; runs on the worker
```

With the `SyncDriver` (the default queue) it still runs immediately; with a
`MemoryDriver` or a real broker it's deferred until a worker drains it.

## A custom channel

A channel is one method — `send`. That's the seam for SMS, Slack, push, or any
provider:

```ts
import type { Channel, Notifiable, Notification } from "@shaferllc/keel/core";

const slack: Channel = {
  async send(notifiable, notification) {
    const payload = notification.toArray?.(notifiable) ?? {};
    // POST payload to a Slack webhook via fetch…
  },
};
setNotifier(new Notifier().channel("slack", slack));
```

## In tests

Register an `ArrayChannel` (or assert on the mail `ArrayTransport`) and check
what was delivered — no network:

```ts
import { setNotifier, Notifier, ArrayChannel, notify } from "@shaferllc/keel/core";

const array = new ArrayChannel();
setNotifier(new Notifier().channel("array", array));

await notify(user, new InvoicePaid(4200)); // a notification whose via() returns ["array"]

assert.equal(array.sent.length, 1);
assert.ok(array.sent[0].notification instanceof InvoicePaid);
```

## Related

Notifications compose the [mail](./mail.md) and [queue](./queues.md) layers, and
the database channel writes through the [query builder](./database.md). Reach for
those directly when you need a one-off email or an ad-hoc queued job.

---

## API reference

### `notify(notifiables, notification)`

`notify(notifiables: Notifiable | Notifiable[], notification: Notification): Promise<void>`

Sends a notification to one or many recipients through the default notifier.

```ts
await notify(user, new InvoicePaid(4200));
await notify([alice, bob], new InvoicePaid(4200));
```

**Notes:** a thin wrapper over `getNotifier().send(...)`. If the notification's
`shouldQueue` is `true`, it resolves once the job is *dispatched*, not once
delivery finishes; otherwise it awaits every channel inline. A single recipient
is normalized to a one-element list.

### `setNotifier(instance)`

`setNotifier(instance: Notifier): Notifier`

Replaces the global notifier used by `notify()` and returns it.

```ts
setNotifier(new Notifier().channel("database", new DatabaseChannel()));
```

**Notes:** global — the last call wins. Because the default notifier only has the
`mail` channel, this is how you register `database`, `array`, or custom channels
app-wide (usually in a service provider).

### `getNotifier()`

`getNotifier(): Notifier`

Returns the current global notifier — handy for registering a channel without
swapping the instance.

```ts
getNotifier().channel("slack", slack);
```

**Notes:** returns the same instance every call until `setNotifier` replaces it.

### `routeFor(notifiable, channel)`

`routeFor(notifiable: Notifiable, channel: string): string | number | undefined`

Resolves the address/id a notifiable receives a given channel at.

```ts
routeFor(user, "mail");     // user.email (string)
routeFor(user, "database"); // user.id (number)
```

**Notes:** tries `notifiable.routeNotificationFor(channel)` first (skipped if it
returns `null`/`undefined`), then falls back to `email` for `"mail"` and `id` for
any other channel. Returns `undefined` when nothing resolves — channels decide
whether that's an error.

### `Notification`

The abstract base for a notification. Subclass it, list channels from `via()`,
and add a `to<Channel>()` builder per channel.

#### `shouldQueue`

`shouldQueue: boolean`

Instance flag — set `true` to deliver from a queued job instead of inline.

```ts
class InvoicePaid extends Notification {
  shouldQueue = true;
}
```

**Notes:** defaults to `false`. Read by `Notifier.send`; when `true`, all
channels run inside the dispatched job.

#### `via(notifiable)`

`via(notifiable: Notifiable): string[]`

Returns the channel names to deliver on for this recipient.

```ts
via(notifiable: Notifiable) {
  return notifiable.email ? ["mail", "database"] : ["database"];
}
```

**Notes:** defaults to `["mail"]`. Called once per recipient, so you can branch
on the notifiable. Every name it returns must be a registered channel or delivery
throws.

#### `toMail(notifiable)`

`toMail?(notifiable: Notifiable): MailContent`

Optional. Builds the content the `mail` channel sends. Required if `via()`
includes `"mail"`.

```ts
toMail(): MailContent {
  return { subject: "Payment received", text: "Thanks!" };
}
```

**Notes:** the mail channel throws if `via()` names `"mail"` but this is
undefined. Set `to` on the returned `MailContent` to override the resolved
recipient address.

#### `toArray(notifiable)`

`toArray?(notifiable: Notifiable): Record<string, unknown>`

Optional. Builds the payload the `database` and `array` channels serialize/store.

```ts
toArray() {
  return { amount: this.amount };
}
```

**Notes:** the database channel stores `{}` when it's undefined; the array
channel keeps the whole notification, not this payload, so a missing `toArray`
still works in tests.

### `Notifier`

Holds the channel registry and drives delivery. `notify()` uses a global one, but
you can construct your own.

#### `channel(name, channel)`

`channel(name: string, channel: Channel): this`

Registers (or replaces) a channel under a name; returns `this` to chain.

```ts
new Notifier()
  .channel("database", new DatabaseChannel())
  .channel("array", new ArrayChannel());
```

**Notes:** a fresh `Notifier` already has `mail` → `MailChannel`. Registering the
same name again replaces it.

#### `send(notifiables, notification)`

`send(notifiables: Notifiable | Notifiable[], notification: Notification): Promise<void>`

Delivers a notification to one or many recipients across the channels its `via()`
returns.

```ts
await new Notifier().send(user, new InvoicePaid(4200));
```

**Notes:** normalizes a single recipient to a list, then delivers to each in
order. Honors `notification.shouldQueue` (dispatches to the queue when set).
Throws on the first unregistered channel name.

### `MailChannel`

The default `mail` channel. Registered on every `Notifier`; you rarely construct
it yourself.

#### `send(notifiable, notification)`

`send(notifiable: Notifiable, notification: Notification): Promise<void>`

Builds a message from `notification.toMail()` and sends it through the mailer.

```ts
await new MailChannel().send(user, new InvoicePaid(4200));
```

**Notes:** throws `… has no toMail()` if the notification lacks one, and
`Notification: no mail route …` if it can't resolve an address (from
`MailContent.to` or `routeFor(notifiable, "mail")`). Applies `from`, `text`, and
`html` only when present.

### `DatabaseChannel`

The `database` channel. Persists the `toArray` payload through the query builder.

#### `new DatabaseChannel(table?)`

`new DatabaseChannel(table?: string)`

Creates a channel that writes to `table`.

```ts
new DatabaseChannel();          // → "notifications"
new DatabaseChannel("alerts");  // → "alerts"
```

**Notes:** defaults to the `notifications` table.

#### `send(notifiable, notification)`

`send(notifiable: Notifiable, notification: Notification): Promise<void>`

Inserts one row: `type` (the notification's class name), `notifiable_id`
(`routeFor(notifiable, "database")`, or `null`), and `data` (JSON of `toArray`).

```ts
await new DatabaseChannel().send(user, new InvoicePaid(4200));
```

**Notes:** stores `"{}"` for `data` when the notification has no `toArray`. The
target table must exist — create it in a migration.

### `ArrayChannel`

An in-memory channel for tests — records deliveries instead of sending them.

#### `sent`

`readonly sent: { notifiable: Notifiable; notification: Notification }[]`

The log of everything this channel received, in delivery order.

```ts
const array = new ArrayChannel();
// … after notify …
array.sent[0].notification; // the Notification instance
```

**Notes:** it keeps the notification *instance*, so you can `instanceof`-check it
or read its fields — no serialization through `toArray`.

#### `send(notifiable, notification)`

`send(notifiable: Notifiable, notification: Notification): Promise<void>`

Pushes `{ notifiable, notification }` onto `sent`. Never touches the network.

```ts
new Notifier().channel("array", new ArrayChannel());
```

### Interfaces & types

#### `Notifiable`

```ts
interface Notifiable {
  routeNotificationFor?(channel: string): string | number | undefined;
  [key: string]: unknown;
}
```

A recipient — anything with routing info, most often a `User` model. Implement
`routeNotificationFor` to steer specific channels; otherwise `routeFor` reads
`email`/`id` off the index signature.

```ts
class User extends Model {
  routeNotificationFor(channel: string) {
    return channel === "mail" ? this.billing_email : undefined;
  }
}
```

#### `MailContent`

```ts
interface MailContent {
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  to?: string;
}
```

What `toMail()` returns and the `mail` channel consumes. `subject` is required;
supply `text`, `html`, or both. `to` overrides the resolved recipient; `from`
overrides the mailer default.

```ts
toMail(): MailContent {
  return { subject: "Welcome", html: "<h1>Hi</h1>", to: "override@app.com" };
}
```

#### `Channel`

```ts
interface Channel {
  send(notifiable: Notifiable, notification: Notification): Promise<void>;
}
```

The seam a custom transport implements — SMS, Slack, push, anything. One method:
`send`. Register your implementation with `Notifier.channel(name, channel)`.

```ts
const slack: Channel = {
  async send(notifiable, notification) {
    const payload = notification.toArray?.(notifiable) ?? {};
    // POST payload to a Slack webhook via fetch…
  },
};
```
