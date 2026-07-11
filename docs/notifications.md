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
`notifiable_id`, and a `data` (JSON) column — create it in a migration.

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
