/**
 * A small, edge-safe mailer. You compose a message with a fluent builder and
 * send it through a pluggable `Transport` — the same shape as the database
 * layer (`setMailer` / `mail()` mirror `setConnection` / `db()`). The core
 * imports no SDK: the built-in transports use `fetch`, `console`, or memory, so
 * it runs on Node and the edge.
 *
 *   setMailer(fetchTransport({ url, headers }), { from: "hi@app.com" });
 *
 *   await mail()
 *     .to("ada@example.com")
 *     .subject("Welcome")
 *     .html("<h1>Hi</h1>")
 *     .send();
 *
 * Sending is slow and it fails — which is exactly what a queue is for. `sendLater()`
 * puts the message on the queue instead of holding the request open for an SMTP
 * round trip:
 *
 *   await mail().to(user.email).subject("Welcome").html(body).sendLater();
 *
 * In tests, `fakeMail()` swaps the transport for one that records and asserts.
 */

import { logger, emit, hasApplication } from "./helpers.js";
import { dispatch, Job } from "./queue.js";
import { contentTypeFor } from "./storage.js";

/**
 * Fire a mail lifecycle event, but only if there's an application to fire it on —
 * the mailer has to work in a unit test that never bootstrapped one. A listener
 * that throws still surfaces; it's only the missing-app case we skip.
 */
async function notify(event: string, message: Message): Promise<void> {
  if (hasApplication()) await emit(event, message);
}

/** A file travelling with the message. */
export interface Attachment {
  filename: string;
  /** Raw bytes, or a string (UTF-8 encoded). */
  content: string | Uint8Array;
  /** MIME type. Inferred from the filename's extension when omitted. */
  contentType?: string;
  /**
   * A content id, for embedding in the HTML body: an attachment with `cid: "logo"`
   * is referenced as `<img src="cid:logo">`. Implies an inline disposition.
   */
  cid?: string;
}

/** A normalized, ready-to-send message. */
export interface Message {
  to: string[];
  from?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: Attachment[];
}

/** The bridge to your email provider. */
export interface Transport {
  send(message: Message): Promise<void>;
}

export interface MailerOptions {
  /** Default `from` address for messages that don't set one. */
  from?: string;
  /** Default `replyTo` for messages that don't set one. */
  replyTo?: string;
}

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/* --------------------------------- builder -------------------------------- */

/** A fluent, immutable-ish builder — chain setters, then `send()` or `sendLater()`. */
export class PendingMail {
  private message: Message = { to: [], subject: "" };

  constructor(private mailer: Mailer) {}

  to(...addresses: string[]): this {
    this.message.to.push(...addresses);
    return this;
  }
  from(address: string): this {
    this.message.from = address;
    return this;
  }
  cc(...addresses: string[]): this {
    (this.message.cc ??= []).push(...addresses);
    return this;
  }
  bcc(...addresses: string[]): this {
    (this.message.bcc ??= []).push(...addresses);
    return this;
  }
  replyTo(address: string): this {
    this.message.replyTo = address;
    return this;
  }
  subject(subject: string): this {
    this.message.subject = subject;
    return this;
  }
  text(text: string): this {
    this.message.text = text;
    return this;
  }
  html(html: string): this {
    this.message.html = html;
    return this;
  }
  header(name: string, value: string): this {
    (this.message.headers ??= {})[name] = value;
    return this;
  }

  /** Attach a file. The content type is inferred from the extension if omitted. */
  attach(filename: string, content: string | Uint8Array, contentType?: string): this {
    (this.message.attachments ??= []).push({
      filename,
      content,
      contentType: contentType ?? contentTypeFor(filename),
    });
    return this;
  }

  /**
   * Attach an image and give it a content id, so the HTML body can show it inline:
   *
   *   .embed("logo", bytes, "logo.png").html(`<img src="cid:logo">`)
   */
  embed(cid: string, content: string | Uint8Array, filename = cid, contentType?: string): this {
    (this.message.attachments ??= []).push({
      filename,
      content,
      contentType: contentType ?? contentTypeFor(filename),
      cid,
    });
    return this;
  }

  /** Seed several fields at once (merges into what's been chained). */
  fill(
    partial: Partial<
      { to: string | string[]; cc: string | string[]; bcc: string | string[] } & Omit<
        Message,
        "to" | "cc" | "bcc"
      >
    >,
  ): this {
    const { to, cc, bcc, ...rest } = partial;
    if (to) this.message.to.push(...list(to));
    if (cc) (this.message.cc ??= []).push(...list(cc));
    if (bcc) (this.message.bcc ??= []).push(...list(bcc));
    Object.assign(this.message, rest);
    return this;
  }

  /** The message as composed so far — before the mailer applies its defaults. */
  toMessage(): Message {
    return { ...this.message };
  }

  /** Freeze and hand the message to the mailer. */
  async send(): Promise<Message> {
    return this.mailer.send(this.message);
  }

  /**
   * Queue the message instead of sending it now — the request returns without
   * waiting on the provider, and a failed send retries on the queue rather than
   * failing the user's action.
   *
   * With the default `SyncDriver` this still sends inline; register a real queue
   * driver to actually defer it.
   */
  async sendLater(): Promise<void> {
    await this.mailer.sendLater(this.message);
  }
}

/* ------------------------------- class mails ------------------------------ */

/**
 * A reusable, testable email as a class — the mail equivalent of a `Job`.
 * Implement `build()` to compose the message; the mailer calls it for you.
 *
 *   export class WelcomeEmail extends BaseMail {
 *     constructor(private user: User) { super(); }
 *
 *     build(message: PendingMail) {
 *       message.to(this.user.email).subject("Welcome").html(`<h1>Hi ${this.user.name}</h1>`);
 *     }
 *   }
 *
 *   await send(new WelcomeEmail(user));       // or sendLater(new WelcomeEmail(user))
 */
export abstract class BaseMail {
  abstract build(message: PendingMail): void | Promise<void>;
}

/** The job that carries a queued message. Exported so a driver can recognize it. */
export class SendMailJob extends Job {
  constructor(
    readonly message: Message,
    readonly mailerName: string,
  ) {
    super();
  }

  async handle(): Promise<void> {
    await mailer(this.mailerName).send(this.message);
  }
}

/* --------------------------------- mailer --------------------------------- */

export class Mailer {
  constructor(
    private transport: Transport,
    private options: MailerOptions = {},
    /** The name this mailer is registered under — carried onto queued jobs. */
    readonly name = "default",
  ) {}

  /** Start composing a message. */
  message(): PendingMail {
    return new PendingMail(this);
  }

  /** Apply this mailer's defaults and check the message is sendable. */
  protected prepare(message: Message): Message {
    const final: Message = {
      ...message,
      from: message.from ?? this.options.from,
      replyTo: message.replyTo ?? this.options.replyTo,
    };

    if (!final.to.length) throw new Error("Mail: at least one recipient (to) is required.");
    if (!final.subject) throw new Error("Mail: a subject is required.");
    if (!final.text && !final.html) throw new Error("Mail: a text or html body is required.");
    if (!final.from) throw new Error("Mail: a from address is required (set one or a default).");

    return final;
  }

  /** Validate, apply defaults, and dispatch through the transport. */
  async send(message: Message): Promise<Message> {
    const final = this.prepare(message);

    await notify("mail.sending", final);
    await this.transport.send(final);
    await notify("mail.sent", final);

    return final;
  }

  /** Validate, apply defaults, and put the message on the queue. */
  async sendLater(message: Message): Promise<Message> {
    // Validate *now*, not on the worker: a malformed message should blow up at
    // the call site, where the stack trace means something.
    const final = this.prepare(message);
    await dispatch(new SendMailJob(final, this.name));
    await notify("mail.queued", final);
    return final;
  }

  /** The underlying transport, for provider-specific operations. */
  get driver(): Transport {
    return this.transport;
  }
}

/* ------------------------------- transports ------------------------------- */

/** Collects sent messages in memory — the default, and ideal for tests. */
export class ArrayTransport implements Transport {
  readonly sent: Message[] = [];
  async send(message: Message): Promise<void> {
    this.sent.push(message);
  }
}

/** Logs each message instead of delivering it — handy in local development. */
export class LogTransport implements Transport {
  async send(message: Message): Promise<void> {
    logger().info("mail sent", {
      to: message.to,
      from: message.from,
      subject: message.subject,
    });
  }
}

export interface FetchTransportOptions {
  /** Provider endpoint to POST to. */
  url: string;
  /** Extra headers (e.g. `Authorization`). `Content-Type: application/json` is added. */
  headers?: Record<string, string>;
  /** Map a message to the provider's request body. Defaults to the message itself. */
  body?: (message: Message) => unknown;
}

/** A generic HTTP transport for provider APIs (Resend, Postmark, …), via `fetch`. */
export function fetchTransport(options: FetchTransportOptions): Transport {
  return {
    async send(message: Message): Promise<void> {
      const res = await fetch(options.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body: JSON.stringify(options.body ? options.body(message) : message),
      });
      if (!res.ok) {
        throw new Error(`Mail: transport responded ${res.status} ${res.statusText}`);
      }
    },
  };
}

/* --------------------------------- faking --------------------------------- */

/** A message recorded by the fake, and whether it was sent now or queued. */
export interface RecordedMail {
  message: Message;
  queued: boolean;
}

/**
 * A `Mailer` that records instead of delivering, with assertions — what
 * `fakeMail()` installs so tests never talk to a provider.
 */
export class FakeMailer extends Mailer {
  readonly mails: RecordedMail[] = [];

  constructor(name = "default", options: MailerOptions = {}) {
    // A from address so a fake never trips the "from is required" check.
    super(new ArrayTransport(), { from: "fake@example.com", ...options }, name);
  }

  override async send(message: Message): Promise<Message> {
    const final = await super.send(message);
    this.mails.push({ message: final, queued: false });
    return final;
  }

  override async sendLater(message: Message): Promise<Message> {
    // Validate exactly as a real mailer would, but don't touch the queue —
    // recording the intent *is* the point.
    const final = this.prepare(message);
    this.mails.push({ message: final, queued: true });
    await notify("mail.queued", final);
    return final;
  }

  /** Everything sent immediately. */
  sent(): Message[] {
    return this.mails.filter((m) => !m.queued).map((m) => m.message);
  }

  /** Everything queued with `sendLater()`. */
  queued(): Message[] {
    return this.mails.filter((m) => m.queued).map((m) => m.message);
  }

  assertSent(where?: (message: Message) => boolean): void {
    const matches = this.sent().filter((m) => where?.(m) ?? true);
    if (matches.length) return;
    throw new Error(
      where && this.sent().length
        ? `Expected a sent mail matching the predicate. ${this.sent().length} were sent, but none matched.`
        : `Expected a mail to be sent, but none was. ${this.summary()}`,
    );
  }

  assertNotSent(where?: (message: Message) => boolean): void {
    const found = this.sent().filter((m) => where?.(m) ?? true).length;
    if (found) throw new Error(`Expected no matching mail to be sent, but ${found} was.`);
  }

  assertSentCount(expected: number): void {
    const found = this.sent().length;
    if (found !== expected) {
      throw new Error(`Expected ${expected} mail(s) to be sent, but ${found} were.`);
    }
  }

  assertQueued(where?: (message: Message) => boolean): void {
    const matches = this.queued().filter((m) => where?.(m) ?? true);
    if (matches.length) return;
    throw new Error(
      where && this.queued().length
        ? `Expected a queued mail matching the predicate. ${this.queued().length} were queued, but none matched.`
        : `Expected a mail to be queued, but none was. ${this.summary()}`,
    );
  }

  assertNotQueued(where?: (message: Message) => boolean): void {
    const found = this.queued().filter((m) => where?.(m) ?? true).length;
    if (found) throw new Error(`Expected no matching mail to be queued, but ${found} was.`);
  }

  assertQueuedCount(expected: number): void {
    const found = this.queued().length;
    if (found !== expected) {
      throw new Error(`Expected ${expected} mail(s) to be queued, but ${found} were.`);
    }
  }

  /** Nothing sent and nothing queued. */
  assertNothingSent(): void {
    if (this.mails.length) {
      throw new Error(`Expected no mail at all, but ${this.mails.length} were recorded. ${this.summary()}`);
    }
  }

  private summary(): string {
    if (!this.mails.length) return "No mail was sent or queued.";
    const subjects = this.mails.map((m) => `"${m.message.subject}"`).join(", ");
    return `Recorded: ${subjects}.`;
  }
}

/* --------------------------------- global --------------------------------- */

const mailers = new Map<string, Mailer>([["default", new Mailer(new ArrayTransport())]]);
/** Mailers displaced by `fakeMail()`, so `restoreMail()` can put them back. */
const realMailers = new Map<string, Mailer>();

/** Register a mailer, optionally under a name (default: `"default"`). */
export function setMailer(transport: Transport, options: MailerOptions = {}, name = "default"): Mailer {
  const instance = new Mailer(transport, options, name);
  mailers.set(name, instance);
  return instance;
}

/** The default mailer, or a named one registered with `setMailer(…, …, name)`. */
export function mailer(name = "default"): Mailer {
  const instance = mailers.get(name);
  if (!instance) throw new Error(`No mailer named "${name}". Register it with setMailer().`);
  return instance;
}

/** The default mailer instance. */
export function getMailer(): Mailer {
  return mailer();
}

/** Start a message on a mailer: `mail().to(…).subject(…).send()`. */
export function mail(name = "default"): PendingMail {
  return mailer(name).message();
}

/** Build a `BaseMail` into a message on the given mailer. */
async function build(email: BaseMail, name: string): Promise<Message> {
  const pending = mailer(name).message();
  await email.build(pending);
  return pending.toMessage();
}

/** Send a class-based mail now. */
export async function send(email: BaseMail, name = "default"): Promise<Message> {
  return mailer(name).send(await build(email, name));
}

/** Queue a class-based mail. */
export async function sendLater(email: BaseMail, name = "default"): Promise<Message> {
  return mailer(name).sendLater(await build(email, name));
}

/**
 * Swap a mailer for a `FakeMailer` so tests never talk to a provider, and assert
 * on what was sent or queued. Undo with `restoreMail()`.
 *
 *   const mail = fakeMail();
 *   await registerUser();
 *   mail.assertQueued((m) => m.subject === "Welcome");
 */
export function fakeMail(name = "default"): FakeMailer {
  const existing = mailers.get(name);
  // Only remember the *real* mailer — faking twice must not stash a fake.
  if (existing && !realMailers.has(name)) realMailers.set(name, existing);

  const fake = new FakeMailer(name);
  mailers.set(name, fake);
  return fake;
}

/** Restore the real mailer after `fakeMail()`. With no name, restores them all. */
export function restoreMail(name?: string): void {
  const names = name ? [name] : [...realMailers.keys()];
  for (const key of names) {
    const real = realMailers.get(key);
    if (real) mailers.set(key, real);
    realMailers.delete(key);
  }
}
