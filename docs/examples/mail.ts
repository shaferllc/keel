// Type-check harness for docs/mail.md. Every type-checkable snippet in the doc
// is exercised here against the real exports, so a renamed method or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  mail,
  setMailer,
  getMailer,
  fetchTransport,
  Mailer,
  PendingMail,
  ArrayTransport,
  LogTransport,
  type Message,
  type Transport,
  type MailerOptions,
  type FetchTransportOptions,
} from "@shaferllc/keel/core";

declare const env: (key: string) => string;
declare const apiKey: string;
declare const message: Message;
declare const myProviderSdk: { emails: { send(m: Message): Promise<void> } };

export async function sending() {
  await mail()
    .to("ada@example.com")
    .subject("Welcome aboard")
    .html("<h1>Hi Ada</h1>")
    .send();

  await mail()
    .to("a@x.com", "b@x.com")
    .cc("team@x.com")
    .bcc("audit@x.com")
    .replyTo("support@x.com")
    .from("hello@x.com")
    .subject("Report")
    .text("Plain-text body")
    .html("<p>HTML body</p>")
    .header("X-Campaign", "weekly")
    .send();

  await mail().fill({ to: "a@x.com", subject: "Hi", text: "body" }).send();

  const sent = await mail().to("ada@example.com").subject("Hi").text("hey").send();
  return { from: sent.from, to: sent.to };
}

export function configuring() {
  setMailer(
    fetchTransport({
      url: "https://api.resend.com/emails",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` },
      body: (m) => ({ from: m.from, to: m.to, subject: m.subject, html: m.html }),
    }),
    { from: "hello@myapp.com" },
  );
}

export function ownTransport() {
  const transport: Transport = {
    async send(message) {
      void message;
    },
  };
  setMailer(transport, { from: "hello@myapp.com" });
}

export async function inTests() {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "hi@app.com" });

  await mail().to("ada@example.com").subject("Welcome").text("hi").send();

  return { count: transport.sent.length, subject: transport.sent[0]?.subject };
}

export async function scopedMailer() {
  const mailer = new Mailer(new ArrayTransport(), { from: "hi@app.com" });
  await mailer.message().to("ada@example.com").subject("Hi").text("hey").send();
}

// ------------------------------- reference ---------------------------------

export async function referenceFunctions() {
  await mail().to("ada@example.com").subject("Hi").text("hey").send();

  const m1: Mailer = setMailer(fetchTransport({ url: "https://x/emails" }), {
    from: "hello@myapp.com",
  });

  const mailer: Mailer = getMailer();
  await mailer.message().to("ada@example.com").subject("Hi").text("hey").send();

  const transport: Transport = fetchTransport({
    url: "https://api.resend.com/emails",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: (m) => ({ from: m.from, to: m.to, subject: m.subject, html: m.html }),
  });

  return { m1, transport };
}

export async function referenceMailer() {
  const mailer = new Mailer(new ArrayTransport(), { from: "hi@app.com" });
  const pending: PendingMail = mailer.message();
  const sent: Message = await mailer.send({
    to: ["ada@x.com"],
    subject: "Hi",
    text: "hey",
  });
  return { pending, sent };
}

export function referencePendingMail() {
  mail().to("a@x.com", "b@x.com");
  mail().from("hello@x.com");
  mail().cc("team@x.com").bcc("audit@x.com");
  mail().replyTo("support@x.com");
  mail().subject("Welcome aboard");
  mail().text("Plain body").html("<p>Rich body</p>");
  mail().header("X-Campaign", "weekly");
  mail().fill({ to: ["a@x.com", "b@x.com"], subject: "Hi", text: "body" });
}

export async function referenceTransports() {
  const transport = new ArrayTransport();
  setMailer(transport);
  transport.sent.length;
  transport.sent[0]?.subject;
  await new ArrayTransport().send(message);

  setMailer(new LogTransport(), { from: "dev@localhost" });
  await new LogTransport().send(message);
}

// ---------------------------- interface / type seams -----------------------

const seamMessage: Message = {
  to: ["ada@x.com"],
  from: "hi@app.com",
  subject: "Hi",
  text: "hey",
};

const seamTransport: Transport = {
  async send(message) {
    await myProviderSdk.emails.send(message);
  },
};

const seamOptions: MailerOptions = { from: "hello@myapp.com" };

const seamFetchOptions: FetchTransportOptions = {
  url: "https://api.resend.com/emails",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: (m) => ({ from: m.from, to: m.to, subject: m.subject, html: m.html }),
};

export { seamMessage, seamTransport, seamOptions, seamFetchOptions };

/* --- Queueing, attachments, class mails, named mailers, faking, events --- */

import {
  mailer as namedMailer,
  send as sendMail,
  sendLater as queueMail,
  fakeMail,
  restoreMail,
  BaseMail,
  listen,
  logger,
  type PendingMail as PendingMailType,
  type Attachment,
  type RecordedMail,
} from "@shaferllc/keel/core";

declare const user2: { email: string; name: string };
declare const body: string;
declare const pdfBytes: Uint8Array;
declare const logoBytes: Uint8Array;
declare const postmark: Transport;
declare const resend: Transport;

export async function queueing() {
  await mail().to(user2.email).subject("Welcome").html(body).sendLater();
}

export async function attachments() {
  await mail()
    .to("ada@example.com")
    .subject("Your invoice")
    .html('<p>Attached. <img src="cid:logo"></p>')
    .attach("invoice.pdf", pdfBytes)
    .attach("data.csv", "a,b,c", "text/csv")
    .embed("logo", logoBytes, "logo.png")
    .send();
}

export class WelcomeEmail extends BaseMail {
  constructor(private user: { email: string; name: string }) {
    super();
  }

  build(message: PendingMailType): void {
    message
      .to(this.user.email)
      .subject(`Welcome, ${this.user.name}`)
      .html(`<h1>Hi ${this.user.name}</h1>`);
  }
}

export async function classBasedMails() {
  await sendMail(new WelcomeEmail(user2));
  await queueMail(new WelcomeEmail(user2));
  await sendMail(new WelcomeEmail(user2), "marketing");
}

export async function namedMailers() {
  setMailer(postmark, { from: "hi@app.com" });
  setMailer(resend, { from: "news@app.com" }, "marketing");

  await mail().to(user2.email).subject("Receipt").text(body).send();
  await mail("marketing").to(user2.email).subject("This month").html(body).send();

  return namedMailer("marketing");
}

export async function faking() {
  const faked = fakeMail();

  faked.assertSent();
  faked.assertSent((m) => m.subject === "Welcome");
  faked.assertSentCount(1);
  faked.assertQueued((m) => m.to.includes("ada@example.com"));
  faked.assertNotSent((m) => m.subject === "Password reset");
  faked.assertNotQueued();
  faked.assertQueuedCount(0);
  faked.assertNothingSent();

  const sent: Message[] = faked.sent();
  const queued: Message[] = faked.queued();
  const all: RecordedMail[] = faked.mails;

  restoreMail();
  restoreMail("marketing");

  return { sent, queued, all };
}

export function mailEvents() {
  listen("mail.sent", (message) => {
    logger().info("mail sent", { subject: (message as Message).subject });
  });
}

export function attachmentType(a: Attachment): string | undefined {
  return a.contentType;
}

export function composed(): Message {
  return mail().to("a@b.com").subject("x").text("y").toMessage();
}
