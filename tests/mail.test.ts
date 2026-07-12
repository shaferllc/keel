import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Mailer,
  ArrayTransport,
  fetchTransport,
  mail,
  mailer,
  send,
  sendLater,
  setMailer,
  getMailer,
  fakeMail,
  restoreMail,
  BaseMail,
  PendingMail,
  type Message,
  type Transport,
} from "../src/core/mail.js";
import { MemoryDriver, SyncDriver, setQueue, work } from "../src/core/queue.js";
import { Application } from "../src/core/application.js";
import { listen, events } from "../src/core/helpers.js";

test("fluent builder composes and sends a message", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com" });

  const sent = await mail()
    .to("ada@example.com", "grace@example.com")
    .cc("cc@example.com")
    .subject("Welcome")
    .html("<h1>Hi</h1>")
    .header("X-Campaign", "onboarding")
    .send();

  assert.equal(transport.sent.length, 1);
  assert.deepEqual(sent.to, ["ada@example.com", "grace@example.com"]);
  assert.deepEqual(sent.cc, ["cc@example.com"]);
  assert.equal(sent.subject, "Welcome");
  assert.equal(sent.html, "<h1>Hi</h1>");
  assert.equal(sent.headers!["X-Campaign"], "onboarding");
});

test("default from is applied when none is set", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "default@app.com" });
  const sent = await mail().to("x@y.com").subject("Hi").text("body").send();
  assert.equal(sent.from, "default@app.com");
});

test("an explicit from overrides the default", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "default@app.com" });
  const sent = await mail().to("x@y.com").from("me@app.com").subject("Hi").text("b").send();
  assert.equal(sent.from, "me@app.com");
});

test("fill seeds multiple fields at once", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com" });
  const sent = await mail()
    .fill({ to: ["a@b.com"], subject: "Report", text: "see attached" })
    .send();
  assert.deepEqual(sent.to, ["a@b.com"]);
  assert.equal(sent.subject, "Report");
});

test("validation: recipient, subject, body, and from are required", async () => {
  const mailer = new Mailer(new ArrayTransport(), {});
  await assert.rejects(() => mailer.send({ to: [], subject: "s", text: "b", from: "f@x" }), /recipient/);
  await assert.rejects(() => mailer.send({ to: ["a@b"], subject: "", text: "b", from: "f@x" }), /subject/);
  await assert.rejects(() => mailer.send({ to: ["a@b"], subject: "s", from: "f@x" }), /body/);
  await assert.rejects(() => mailer.send({ to: ["a@b"], subject: "s", text: "b" }), /from/);
});

test("fetchTransport POSTs JSON and honors a body mapper", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, statusText: "OK" } as Response;
  }) as typeof fetch;

  try {
    const transport = fetchTransport({
      url: "https://api.mail.test/send",
      headers: { Authorization: "Bearer k" },
      body: (m: Message) => ({ recipient: m.to[0], sub: m.subject }),
    });
    setMailer(transport, { from: "hi@app.com" });
    await mail().to("a@b.com").subject("Hi").text("b").send();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.mail.test/send");
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers.Authorization, "Bearer k");
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { recipient: "a@b.com", sub: "Hi" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchTransport throws on a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 422, statusText: "Unprocessable" }) as Response) as typeof fetch;
  try {
    const transport = fetchTransport({ url: "https://api.mail.test/send" });
    await assert.rejects(
      () => transport.send({ to: ["a@b"], subject: "s", text: "b", from: "f@x" }),
      /422 Unprocessable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a custom transport receives the finalized message", async () => {
  const received: Message[] = [];
  const custom: Transport = { async send(m) { received.push(m); } };
  setMailer(custom, { from: "hi@app.com" });
  await mail().to("a@b.com").subject("Hi").text("b").send();
  assert.equal(received[0]!.from, "hi@app.com");
});

/* ------------------------------ attachments ------------------------------- */

test("attach and embed put files on the message", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com" });

  await mail()
    .to("a@b.com")
    .subject("Report")
    .html('<img src="cid:logo">')
    .attach("report.csv", "a,b,c", "text/csv")
    .embed("logo", new Uint8Array([1, 2, 3]), "logo.png")
    .send();

  const attachments = transport.sent[0]!.attachments!;
  assert.equal(attachments.length, 2);

  assert.deepEqual(attachments[0], {
    filename: "report.csv",
    content: "a,b,c",
    contentType: "text/csv",
  });

  // An embedded file carries a cid, which the HTML references as cid:logo.
  assert.equal(attachments[1]!.cid, "logo");
  assert.equal(attachments[1]!.filename, "logo.png");
  // ...and its content type is inferred from the filename.
  assert.equal(attachments[1]!.contentType, "image/png");
});

test("an attachment's content type is inferred from its extension", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com" });

  await mail()
    .to("a@b.com")
    .subject("x")
    .text("y")
    .attach("invoice.pdf", new Uint8Array([1]))
    .attach("data", new Uint8Array([1])) // no extension → octet-stream
    .send();

  const attachments = transport.sent[0]!.attachments!;
  assert.equal(attachments[0]!.contentType, "application/pdf");
  assert.equal(attachments[1]!.contentType, "application/octet-stream");
});

/* -------------------------------- defaults -------------------------------- */

test("a mailer's default replyTo applies when the message sets none", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com", replyTo: "support@app.com" });

  await mail().to("a@b.com").subject("x").text("y").send();
  assert.equal(transport.sent[0]!.replyTo, "support@app.com");

  await mail().to("a@b.com").subject("x").text("y").replyTo("sales@app.com").send();
  assert.equal(transport.sent[1]!.replyTo, "sales@app.com"); // an explicit one wins
});

/* ----------------------------- named mailers ------------------------------ */

test("mailers can be registered by name", async () => {
  const primary = new ArrayTransport();
  const marketing = new ArrayTransport();

  setMailer(primary, { from: "hi@app.com" });
  setMailer(marketing, { from: "news@app.com" }, "marketing");

  await mail().to("a@b.com").subject("tx").text("y").send();
  await mail("marketing").to("a@b.com").subject("news").text("y").send();

  assert.equal(primary.sent.length, 1);
  assert.equal(primary.sent[0]!.from, "hi@app.com");
  assert.equal(marketing.sent.length, 1);
  assert.equal(marketing.sent[0]!.from, "news@app.com");
});

test("mailer() throws for an unknown name", () => {
  assert.throws(() => mailer("nope"), /No mailer named "nope"/);
});

/* -------------------------------- sendLater ------------------------------- */

test("sendLater puts the message on the queue instead of sending it", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com" });

  const driver = new MemoryDriver();
  setQueue(driver);

  await mail().to("a@b.com").subject("Welcome").text("hi").sendLater();

  // Nothing sent yet — it's waiting on the queue.
  assert.equal(transport.sent.length, 0);
  assert.equal(driver.size, 1);

  await work();

  // Now it's gone out.
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0]!.subject, "Welcome");

  setQueue(new SyncDriver());
});

test("sendLater validates at the call site, not on the worker", async () => {
  setMailer(new ArrayTransport(), { from: "hi@app.com" });
  setQueue(new MemoryDriver());

  // A malformed message must blow up where it was composed, not later in a worker
  // where the stack trace means nothing.
  await assert.rejects(() => mail().subject("no recipient").text("x").sendLater(), /recipient/);

  setQueue(new SyncDriver());
});

/* ------------------------------- class mails ------------------------------ */

class WelcomeEmail extends BaseMail {
  constructor(private user: { email: string; name: string }) {
    super();
  }

  build(message: PendingMail): void {
    message
      .to(this.user.email)
      .subject(`Welcome, ${this.user.name}`)
      .html(`<h1>Hi ${this.user.name}</h1>`);
  }
}

test("a BaseMail builds and sends", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com" });

  await send(new WelcomeEmail({ email: "ada@x.com", name: "Ada" }));

  const sent = transport.sent[0]!;
  assert.deepEqual(sent.to, ["ada@x.com"]);
  assert.equal(sent.subject, "Welcome, Ada");
  assert.equal(sent.html, "<h1>Hi Ada</h1>");
  assert.equal(sent.from, "hi@app.com"); // the mailer's default
});

test("a BaseMail can be queued", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com" });
  const driver = new MemoryDriver();
  setQueue(driver);

  await sendLater(new WelcomeEmail({ email: "ada@x.com", name: "Ada" }));

  assert.equal(transport.sent.length, 0);
  assert.equal(driver.size, 1);

  await work();
  assert.equal(transport.sent[0]!.subject, "Welcome, Ada");

  setQueue(new SyncDriver());
});

/* --------------------------------- faking --------------------------------- */

test("fakeMail records sends without touching the transport", async () => {
  const real = new ArrayTransport();
  setMailer(real, { from: "hi@app.com" });

  const faked = fakeMail();

  await mail().to("a@b.com").subject("Welcome").text("hi").send();

  assert.equal(real.sent.length, 0, "the real transport must not be touched");

  faked.assertSent();
  faked.assertSent((m) => m.subject === "Welcome");
  faked.assertSentCount(1);
  faked.assertNotQueued();
  assert.equal(faked.sent()[0]!.to[0], "a@b.com");

  restoreMail();
  assert.equal(getMailer().driver, real);
});

test("the fake separates sent from queued", async () => {
  setMailer(new ArrayTransport(), { from: "hi@app.com" });
  const faked = fakeMail();

  await mail().to("a@b.com").subject("Now").text("x").send();
  await mail().to("a@b.com").subject("Later").text("x").sendLater();

  faked.assertSentCount(1);
  faked.assertQueuedCount(1);
  faked.assertSent((m) => m.subject === "Now");
  faked.assertQueued((m) => m.subject === "Later");
  faked.assertNotSent((m) => m.subject === "Later");

  restoreMail();
});

test("a faked sendLater does not reach the queue", async () => {
  setMailer(new ArrayTransport(), { from: "hi@app.com" });
  const driver = new MemoryDriver();
  setQueue(driver);

  const faked = fakeMail();
  await mail().to("a@b.com").subject("Later").text("x").sendLater();

  assert.equal(driver.size, 0, "recording the intent is the point — no real dispatch");
  faked.assertQueued();

  restoreMail();
  setQueue(new SyncDriver());
});

test("fake assertions fail with a useful message", async () => {
  setMailer(new ArrayTransport(), { from: "hi@app.com" });
  const faked = fakeMail();

  await mail().to("a@b.com").subject("Welcome").text("x").send();

  assert.throws(() => faked.assertNotSent(), /Expected no matching mail to be sent, but 1 was/);
  assert.throws(() => faked.assertSentCount(3), /Expected 3 mail\(s\) to be sent, but 1 were/);
  assert.throws(() => faked.assertQueued(), /Expected a mail to be queued, but none was/);
  assert.throws(() => faked.assertNothingSent(), /Expected no mail at all, but 1 were recorded/);
  assert.throws(
    () => faked.assertSent((m) => m.subject === "Nope"),
    /1 were sent, but none matched/,
  );

  restoreMail();
});

test("assertNothingSent passes on an untouched fake", () => {
  setMailer(new ArrayTransport(), { from: "hi@app.com" });
  const faked = fakeMail();
  faked.assertNothingSent();
  restoreMail();
});

test("a fake still validates the message", async () => {
  setMailer(new ArrayTransport(), { from: "hi@app.com" });
  fakeMail();

  // The fake must not paper over a message the real mailer would reject.
  await assert.rejects(() => mail().subject("x").text("y").send(), /recipient/);

  restoreMail();
});

test("faking twice still restores the real mailer", async () => {
  const real = new ArrayTransport();
  setMailer(real, { from: "hi@app.com" });

  fakeMail();
  fakeMail();
  restoreMail();

  assert.equal(getMailer().driver, real);
});

/* --------------------------------- events --------------------------------- */

test("sending emits mail.sending and mail.sent", async () => {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });

  setMailer(new ArrayTransport(), { from: "hi@app.com" });

  const seen: string[] = [];
  listen("mail.sending", () => void seen.push("sending"));
  listen("mail.sent", () => void seen.push("sent"));

  await mail().to("a@b.com").subject("x").text("y").send();

  assert.deepEqual(seen, ["sending", "sent"]);
  events().clear();
});
