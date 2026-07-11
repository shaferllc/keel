import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Mailer,
  ArrayTransport,
  fetchTransport,
  mail,
  setMailer,
  type Message,
  type Transport,
} from "../src/core/mail.js";

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
