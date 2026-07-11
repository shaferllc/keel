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

A message needs at least one recipient, a subject, a body (`text` or `html`),
and a `from` — `send()` throws a clear error otherwise.

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
message is sent as-is.

## Built-in transports

| Transport | Use |
|-----------|-----|
| `ArrayTransport` | Collects messages in `.sent` — the default, and ideal for tests |
| `LogTransport` | Logs each message via the logger instead of delivering — local dev |
| `fetchTransport(opts)` | POSTs to a provider HTTP API via `fetch` — production |

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

## In tests

Register an `ArrayTransport` and assert on what was queued — no network, no SDK:

```ts
import { setMailer, ArrayTransport, mail } from "@shaferllc/keel/core";

const transport = new ArrayTransport();
setMailer(transport, { from: "hi@app.com" });

await mail().to("ada@example.com").subject("Welcome").text("hi").send();

assert.equal(transport.sent.length, 1);
assert.equal(transport.sent[0].subject, "Welcome");
```
