# Mail

Send email through a pluggable **transport**. Compose a message with a fluent
builder and dispatch it — the API mirrors the database layer (`setMailer` /
`mail()` are to mail what `setConnection` / `db()` are to the database). The core
imports no SDK: the built-in transports use `fetch`, `console`, or memory, so it
runs on Node and the edge.

## Sending

```ts
import { mail } from "@shaferllc/keel/core";

await mail()
  .to("ada@example.com")
  .subject("Welcome aboard")
  .html("<h1>Hi Ada</h1>")
  .send();
```

Every setter is chainable, and several accept multiple values:

```ts
await mail()
  .to("a@x.com", "b@x.com")
  .cc("team@x.com")
  .bcc("audit@x.com")
  .replyTo("support@x.com")
  .from("hello@x.com")        // optional if a default is configured
  .subject("Report")
  .text("Plain-text body")
  .html("<p>HTML body</p>")
  .header("X-Campaign", "weekly")
  .send();
```

Seed several fields at once with `fill()`:

```ts
await mail().fill({ to: "a@x.com", subject: "Hi", text: "body" }).send();
```

`send()` resolves to the **finalized message** — the same object the transport
received, with the default `from` already applied. Handy for logging or
assertions:

```ts
const sent = await mail().to("ada@example.com").subject("Hi").text("hey").send();
sent.from;    // the resolved from address
sent.to;      // ["ada@example.com"]
```

## Validation & error behavior

A message needs at least one recipient, a subject, a body (`text` or `html`),
and a `from` — `send()` throws a clear `Error` otherwise, before the transport is
ever called. The checks run in this order:

| Missing | Message |
|---------|---------|
| `to` (empty) | `Mail: at least one recipient (to) is required.` |
| `subject` | `Mail: a subject is required.` |
| `text` **and** `html` | `Mail: a text or html body is required.` |
| `from` (and no default) | `Mail: a from address is required (set one or a default).` |

The `from` default from `setMailer(..., { from })` is applied first, so a
configured default satisfies the last check without any per-message `from`.

## Configuring the transport

Register a default transport once (typically in a service provider):

```ts
import { setMailer, fetchTransport } from "@shaferllc/keel/core";

setMailer(
  fetchTransport({
    url: "https://api.resend.com/emails",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` },
    body: (m) => ({ from: m.from, to: m.to, subject: m.subject, html: m.html }),
  }),
  { from: "hello@myapp.com" }, // default `from` for messages that omit one
);
```

`fetchTransport` POSTs JSON to any provider API (Resend, Postmark, Mailgun, …).
The optional `body` mapper shapes the request for that provider; without it the
message is sent as-is. A non-2xx response throws
`Mail: transport responded <status> <statusText>`.

## Built-in transports

| Transport | Use |
|-----------|-----|
| `ArrayTransport` | Collects messages in `.sent` — the default, and ideal for tests |
| `LogTransport` | Logs each message via the logger instead of delivering — local dev |
| `fetchTransport(opts)` | POSTs to a provider HTTP API via `fetch` — production |

Until you call `setMailer`, the default mailer is a fresh `ArrayTransport` — so
`mail()` never throws for want of a transport, it just buffers in memory.

## Writing your own transport

A transport is one method:

```ts
import type { Transport } from "@shaferllc/keel/core";

const transport: Transport = {
  async send(message) {
    // hand `message` to any SDK or API you like
  },
};
setMailer(transport, { from: "hello@myapp.com" });
```

The `message` your `send` receives is already validated and has `from` resolved,
so a transport can trust every required field is present.

## Queueing: `sendLater()`

Sending is slow and it fails. Holding a request open for an SMTP round trip means
the user waits on your provider, and a provider hiccup turns "sign up" into an
error page. Put the message on the [queue](./queues.md) instead:

```ts
await mail().to(user.email).subject("Welcome").html(body).sendLater();
```

The request returns immediately, and a failed send **retries on the queue** rather
than failing the user's action. Everything else is identical — same builder, same
transport.

The message is **validated at the call site**, not on the worker: a missing
recipient throws where you composed it, where the stack trace means something,
rather than surfacing in a worker log an hour later.

With the default `SyncDriver` this still sends inline (nothing is deferred until
you register a real driver), so `sendLater()` is safe to adopt before you have a
queue.

## Attachments

```ts
await mail()
  .to("ada@example.com")
  .subject("Your invoice")
  .html('<p>Attached. <img src="cid:logo"></p>')
  .attach("invoice.pdf", pdfBytes)          // content type inferred: application/pdf
  .attach("data.csv", "a,b,c", "text/csv")  // ...or set it
  .embed("logo", logoBytes, "logo.png")     // inline, referenced as cid:logo
  .send();
```

`attach(filename, content, contentType?)` takes a string or `Uint8Array`; the
content type is inferred from the extension when you don't give one.

`embed(cid, content, filename?, contentType?)` is the same thing with a **content
id**, so the HTML body can display it inline via `<img src="cid:logo">` instead of
linking out to a hosted image.

## Class-based mails

A one-liner is fine until the email has real content. `BaseMail` is to mail what
`Job` is to the queue — a reusable, testable class:

```ts
import { BaseMail, type PendingMail } from "@shaferllc/keel/core";

export class WelcomeEmail extends BaseMail {
  constructor(private user: User) {
    super();
  }

  build(message: PendingMail) {
    message
      .to(this.user.email)
      .subject(`Welcome, ${this.user.name}`)
      .html(`<h1>Hi ${this.user.name}</h1>`);
  }
}
```

```ts
import { send, sendLater } from "@shaferllc/keel/core";

await send(new WelcomeEmail(user));
await sendLater(new WelcomeEmail(user)); // ...or queue it
```

`build()` may be async, so it can render a template or fetch what it needs.

## Multiple mailers

Register mailers by name — a transactional provider and a marketing one, say — and
pick one with `mail(name)`:

```ts
setMailer(postmark, { from: "hi@app.com" });                    // the default
setMailer(resend, { from: "news@app.com" }, "marketing");

await mail().to(user.email).subject("Receipt").text(body).send();
await mail("marketing").to(user.email).subject("This month").html(body).send();
```

`send(email, name)` and `sendLater(email, name)` take a mailer name too.

## In tests

`fakeMail()` swaps the mailer for one that **records instead of delivering**, so
tests never talk to a provider. `restoreMail()` puts the real one back.

```ts
import { fakeMail, restoreMail } from "@shaferllc/keel/core";

const mailer = fakeMail();

await registerUser();

mailer.assertSent();
mailer.assertSent((m) => m.subject === "Welcome");
mailer.assertSentCount(1);
mailer.assertQueued((m) => m.to.includes("ada@example.com")); // sent with sendLater()
mailer.assertNotSent((m) => m.subject === "Password reset");
mailer.assertNothingSent();

restoreMail();
```

The fake keeps **sent** and **queued** separate — `assertSent` only matches
`send()`, `assertQueued` only `sendLater()` — so a test can tell "we emailed them"
from "we queued an email". A faked `sendLater()` doesn't touch the real queue
either; recording the intent is the point.

It still **validates** the message, so a fake can't paper over a message the real
mailer would reject.

`mailer.sent()` and `mailer.queued()` return the raw messages if you'd rather
assert by hand.

If you want the transport-level view instead, `ArrayTransport` still works:

```ts
const transport = new ArrayTransport();
setMailer(transport, { from: "hi@app.com" });

await mail().to("ada@example.com").subject("Welcome").text("hi").send();

assert.equal(transport.sent[0].subject, "Welcome");
```

You can also hold your own `Mailer` instead of the global one — construct it with
a transport and reuse it, leaving the process-wide `mail()` untouched:

```ts
import { Mailer, ArrayTransport } from "@shaferllc/keel/core";

const mailer = new Mailer(new ArrayTransport(), { from: "hi@app.com" });
await mailer.message().to("ada@example.com").subject("Hi").text("hey").send();
```

## Events

Every send fires [events](./events.md), so logging, metrics, and auditing can hang
off mail without touching the mailer:

| Event | When |
|-------|------|
| `mail.sending` | before the transport is called |
| `mail.sent` | after it returns |
| `mail.queued` | a `sendLater()` message reached the queue |

Each carries the final `Message` — after defaults are applied.

```ts
listen("mail.sent", (message) => logger().info("mail sent", { subject: message.subject }));
```

## Related

The mail layer stands alone, but the [database](./database.md) builder shares its
shape (`setConnection`/`db` mirror `setMailer`/`mail`) — the same register-once,
call-anywhere pattern.

---

## API reference

### `mail()`

`mail(): PendingMail`

Starts composing a message on the default (global) mailer.

```ts
await mail().to("ada@example.com").subject("Hi").text("hey").send();
```

**Notes:** a thin shortcut for `getMailer().message()`. Uses whatever transport
and options were last passed to `setMailer` (an in-memory `ArrayTransport` if you
never called it).

### `setMailer(transport, options?)`

`setMailer(transport: Transport, options?: MailerOptions): Mailer`

Replaces the global mailer with a new one built from `transport` and `options`,
and returns it.

```ts
setMailer(fetchTransport({ url }), { from: "hello@myapp.com" });
```

**Notes:** global — the last call wins. Returns the constructed `Mailer` if you
want a direct handle. `options` defaults to `{}` (no default `from`).

### `getMailer()`

`getMailer(): Mailer`

Returns the current global `Mailer` instance.

```ts
const mailer = getMailer();
await mailer.message().to("ada@example.com").subject("Hi").text("hey").send();
```

**Notes:** before any `setMailer` call this is a `Mailer` wrapping a fresh
`ArrayTransport`.

### `fetchTransport(options)`

`fetchTransport(options: FetchTransportOptions): Transport`

Builds a `Transport` that POSTs each message as JSON to a provider HTTP API via
`fetch`.

```ts
const transport = fetchTransport({
  url: "https://api.resend.com/emails",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: (m) => ({ from: m.from, to: m.to, subject: m.subject, html: m.html }),
});
```

**Notes:** always sets `Content-Type: application/json`; your `headers` merge on
top. Without a `body` mapper the raw `Message` is serialized. Throws
`Mail: transport responded <status> <statusText>` on any non-`ok` response.

### `Mailer`

The engine that validates a message, applies defaults, and hands it to the
transport. Construct one directly (`new Mailer(transport, options?)`) for a
scoped mailer, or reach the global one via `getMailer()` / `setMailer()`.

#### `new Mailer(transport, options?)`

`new Mailer(transport: Transport, options?: MailerOptions)`

Wraps a transport and its options.

```ts
const mailer = new Mailer(new ArrayTransport(), { from: "hi@app.com" });
```

**Notes:** `options` defaults to `{}`. The transport is fixed for this instance —
build a new `Mailer` to swap it.

#### `message()`

`message(): PendingMail`

Starts a new `PendingMail` bound to this mailer.

```ts
const pending = mailer.message();
```

**Notes:** each call returns a fresh builder; nothing is shared between messages.

#### `send(message)`

`send(message: Message): Promise<Message>`

Applies the default `from`, validates the message, dispatches it through the
transport, and resolves to the finalized message.

```ts
const sent = await mailer.send({ to: ["ada@x.com"], subject: "Hi", text: "hey" });
```

**Notes:** throws (before touching the transport) if `to` is empty, or `subject`,
a body, or `from` is missing — see [Validation](#validation--error-behavior).
`PendingMail.send()` funnels through here. The returned object is a shallow copy
with `from` resolved.

### `PendingMail`

The fluent builder. You get one from `mail()` or `mailer.message()`, never
`new`. Every setter returns `this`, so calls chain in any order; nothing is sent
until `send()`.

#### `to(...addresses)`

`to(...addresses: string[]): this`

Appends one or more recipients.

```ts
mail().to("a@x.com", "b@x.com");
```

**Notes:** additive — repeated calls accumulate recipients rather than replace.

#### `from(address)`

`from(address: string): this`

Sets the sender, overriding the mailer's default `from`.

```ts
mail().from("hello@x.com");
```

**Notes:** a single value (not variadic). Optional when a default `from` is
configured on the mailer.

#### `cc(...addresses)` / `bcc(...addresses)`

`cc(...addresses: string[]): this`
`bcc(...addresses: string[]): this`

Append carbon-copy / blind-carbon-copy recipients.

```ts
mail().cc("team@x.com").bcc("audit@x.com");
```

**Notes:** both additive, like `to`. The underlying arrays are created lazily on
first use.

#### `replyTo(address)`

`replyTo(address: string): this`

Sets the `Reply-To` address.

```ts
mail().replyTo("support@x.com");
```

**Notes:** a single value; a later call replaces the prior one.

#### `subject(subject)`

`subject(subject: string): this`

Sets the subject line.

```ts
mail().subject("Welcome aboard");
```

**Notes:** required — `send()` throws if it's empty. A later call replaces it.

#### `text(text)` / `html(html)`

`text(text: string): this`
`html(html: string): this`

Set the plain-text / HTML body. At least one is required.

```ts
mail().text("Plain body").html("<p>Rich body</p>");
```

**Notes:** you can set both (a multipart message); `send()` throws only if
*neither* is present. Each later call replaces its body.

#### `header(name, value)`

`header(name: string, value: string): this`

Adds a custom header.

```ts
mail().header("X-Campaign", "weekly");
```

**Notes:** additive per name — repeated calls with distinct names accumulate;
the same name overwrites. The `headers` object is created lazily.

#### `fill(partial)`

`fill(partial: Partial<{ to: string | string[]; cc: string | string[]; bcc: string | string[] } & Omit<Message, "to" | "cc" | "bcc">>): this`

Seeds several fields at once, merging into whatever's been chained.

```ts
mail().fill({ to: ["a@x.com", "b@x.com"], subject: "Hi", text: "body" });
```

**Notes:** `to`/`cc`/`bcc` accept a single string or an array and are **appended**
to any existing recipients. The other fields (`from`, `subject`, `text`, `html`,
`replyTo`, `headers`) are assigned, **replacing** prior values — passing
`headers` here overwrites the whole header map rather than merging.

#### `send()`

`send(): Promise<Message>`

Hands the composed message to the mailer and resolves to the finalized message.

```ts
const sent = await mail().to("ada@x.com").subject("Hi").text("hey").send();
```

**Notes:** delegates to `Mailer.send`, so the same validation and default-`from`
handling apply; it throws on a missing required field.

### `ArrayTransport`

An in-memory transport that records every message. The default transport, and
the one to use in tests.

#### `new ArrayTransport()`

`new ArrayTransport()`

Creates a transport with an empty `sent` array.

```ts
const transport = new ArrayTransport();
```

#### `sent`

`readonly sent: Message[]`

The messages this transport has received, in order.

```ts
const transport = new ArrayTransport();
setMailer(transport);
// ...after sending...
transport.sent.length;       // number of messages queued
transport.sent[0]?.subject;  // first message's subject
```

**Notes:** `readonly` binding but the array is mutated on each `send` — assert on
`.length` and elements.

#### `send(message)`

`send(message: Message): Promise<void>`

Pushes the message onto `sent`.

```ts
await new ArrayTransport().send(message);
```

**Notes:** never throws; delivers nothing. Called for you by `Mailer.send`.

### `LogTransport`

A transport that logs each message (to, from, subject) via the framework logger
instead of delivering it — for local development.

#### `new LogTransport()`

`new LogTransport()`

Creates the transport.

```ts
setMailer(new LogTransport(), { from: "dev@localhost" });
```

#### `send(message)`

`send(message: Message): Promise<void>`

Logs `to`, `from`, and `subject` at info level; sends nothing.

```ts
await new LogTransport().send(message);
```

**Notes:** the body is not logged, only the envelope fields.

### Interfaces & types

#### `Message`

```ts
interface Message {
  to: string[];
  from?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}
```

The normalized, ready-to-send message. The builder produces one; a `Transport`
receives one (already validated, with `from` resolved). You can also build one by
hand and pass it to `Mailer.send`.

```ts
const message: Message = {
  to: ["ada@x.com"],
  from: "hi@app.com",
  subject: "Hi",
  text: "hey",
};
```

#### `Transport`

```ts
interface Transport {
  send(message: Message): Promise<void>;
}
```

The seam between the mailer and your email provider — one method. Implement it to
bridge any SDK or API; register it with `setMailer`.

```ts
const transport: Transport = {
  async send(message) {
    await myProviderSdk.emails.send(message);
  },
};
setMailer(transport, { from: "hi@app.com" });
```

#### `MailerOptions`

```ts
interface MailerOptions {
  from?: string;
}
```

Options for a `Mailer`. Currently just a default `from` applied to messages that
don't set one.

```ts
setMailer(transport, { from: "hello@myapp.com" });
```

#### `FetchTransportOptions`

```ts
interface FetchTransportOptions {
  url: string;
  headers?: Record<string, string>;
  body?: (message: Message) => unknown;
}
```

Configuration for `fetchTransport`. `url` is the provider endpoint; `headers`
merge over the automatic `Content-Type: application/json`; `body` maps a
`Message` to the provider's request shape (defaults to the message itself).

```ts
const opts: FetchTransportOptions = {
  url: "https://api.resend.com/emails",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: (m) => ({ from: m.from, to: m.to, subject: m.subject, html: m.html }),
};
```

### `mailer(name?)`

`mailer(name?: string): Mailer` — the default mailer, or a named one. Throws for an
unknown name.

### `send(email, name?)` / `sendLater(email, name?)`

`send(email: BaseMail, name?: string): Promise<Message>` — build a class-based mail
and send it. `sendLater` queues it instead.

### `BaseMail`

Abstract. Implement `build(message: PendingMail): void | Promise<void>` to compose
the message.

### `PendingMail.sendLater()`

`sendLater(): Promise<void>` — validate now, then put the message on the queue.

### `PendingMail.attach()` / `.embed()`

`attach(filename, content: string | Uint8Array, contentType?): this` — content type
inferred from the extension when omitted.

`embed(cid, content, filename?, contentType?): this` — an inline attachment,
referenced from the HTML as `cid:<cid>`.

### `PendingMail.toMessage()`

`toMessage(): Message` — the message as composed, before the mailer applies its
defaults.

### Testing

#### `fakeMail(name?)` / `restoreMail(name?)`

`fakeMail(name?): FakeMailer` swaps a mailer for one that records instead of
delivering. `restoreMail(name?)` puts the real one back — with no name, every faked
mailer.

`FakeMailer`:

| Method | Signature |
|--------|-----------|
| `assertSent` | `(where?) => void` |
| `assertNotSent` | `(where?) => void` |
| `assertSentCount` | `(count) => void` |
| `assertQueued` | `(where?) => void` |
| `assertNotQueued` | `(where?) => void` |
| `assertQueuedCount` | `(count) => void` |
| `assertNothingSent` | `() => void` — nothing sent *and* nothing queued |
| `sent()` / `queued()` | `() => Message[]` |

### Interfaces & types

#### `Attachment`

`{ filename, content: string | Uint8Array, contentType?, cid? }` — a `cid` makes it
an inline attachment.

#### `MailerOptions`

`{ from?, replyTo? }` — defaults applied to messages that don't set their own.

#### `RecordedMail`

`{ message: Message, queued: boolean }` — what a `FakeMailer` records.

#### `SendMailJob`

The `Job` that carries a queued message. Exported so a custom queue driver can
recognize it.
