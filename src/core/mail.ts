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
 * In tests, register an `ArrayTransport` and assert on `transport.sent`.
 */

import { logger } from "./helpers.js";

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
}

/** The bridge to your email provider. */
export interface Transport {
  send(message: Message): Promise<void>;
}

export interface MailerOptions {
  /** Default `from` address for messages that don't set one. */
  from?: string;
}

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** A fluent, immutable-ish builder — chain setters, then `send()`. */
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

  /** Seed several fields at once (merges into what's been chained). */
  fill(partial: Partial<{ to: string | string[]; cc: string | string[]; bcc: string | string[] } & Omit<Message, "to" | "cc" | "bcc">>): this {
    const { to, cc, bcc, ...rest } = partial;
    if (to) this.message.to.push(...list(to));
    if (cc) (this.message.cc ??= []).push(...list(cc));
    if (bcc) (this.message.bcc ??= []).push(...list(bcc));
    Object.assign(this.message, rest);
    return this;
  }

  /** Freeze and hand the message to the mailer. */
  async send(): Promise<Message> {
    return this.mailer.send(this.message);
  }
}

export class Mailer {
  constructor(
    private transport: Transport,
    private options: MailerOptions = {},
  ) {}

  /** Start composing a message. */
  message(): PendingMail {
    return new PendingMail(this);
  }

  /** Validate, apply defaults, and dispatch through the transport. */
  async send(message: Message): Promise<Message> {
    const final: Message = { ...message, from: message.from ?? this.options.from };

    if (!final.to.length) throw new Error("Mail: at least one recipient (to) is required.");
    if (!final.subject) throw new Error("Mail: a subject is required.");
    if (!final.text && !final.html) throw new Error("Mail: a text or html body is required.");
    if (!final.from) throw new Error("Mail: a from address is required (set one or a default).");

    await this.transport.send(final);
    return final;
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

/* --------------------------------- global --------------------------------- */

let mailer: Mailer = new Mailer(new ArrayTransport());

/** Register the default mailer used by `mail()`. */
export function setMailer(transport: Transport, options: MailerOptions = {}): Mailer {
  mailer = new Mailer(transport, options);
  return mailer;
}

/** The default mailer instance. */
export function getMailer(): Mailer {
  return mailer;
}

/** Start a message on the default mailer: `mail().to(…).subject(…).send()`. */
export function mail(): PendingMail {
  return mailer.message();
}
