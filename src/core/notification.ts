/**
 * Notifications — send a message to a recipient over one or more channels
 * (mail, database, or your own), inline or through the queue. This is where the
 * mail and queue layers compose: a notification declares *what* to say and
 * *which channels* carry it, and each channel decides *how*.
 *
 *   class InvoicePaid extends Notification {
 *     constructor(private amount: number) { super(); }
 *     via() { return ["mail", "database"]; }
 *     toMail() { return { subject: "Payment received", text: `Thanks for $${this.amount}.` }; }
 *     toArray() { return { amount: this.amount }; }
 *   }
 *
 *   await notify(user, new InvoicePaid(4200));   // user.email routes the mail
 *
 * Set `shouldQueue = true` on a notification to deliver it from a queued job
 * instead of inline. Channels are pluggable, so `array` (for tests) or a custom
 * push-to-provider channel slot in the same way transports and drivers do.
 */

import { db } from "./database.js";
import { getMailer } from "./mail.js";
import { dispatch } from "./queue.js";
import { instrument, currentRequestId } from "./instrumentation.js";

/** A recipient. Anything with routing info — often a `User` model. */
export interface Notifiable {
  /** Return the address/id for a channel (e.g. an email). Falls back to `email`/`id`. */
  routeNotificationFor?(channel: string): string | number | undefined;
  [key: string]: unknown;
}

/** What a notification hands the mail channel. */
export interface MailContent {
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  /** Override the resolved recipient address. */
  to?: string;
}

export abstract class Notification {
  /** Deliver from a queued job instead of inline. */
  shouldQueue = false;

  /** Channels to deliver on. Default: mail. */
  via(_notifiable: Notifiable): string[] {
    return ["mail"];
  }

  /** Build the mail-channel content. Required if `via` includes "mail". */
  toMail?(notifiable: Notifiable): MailContent;

  /** Build the payload stored/serialized by the database and array channels. */
  toArray?(notifiable: Notifiable): Record<string, unknown>;
}

/** Resolve where a notifiable receives a given channel. */
export function routeFor(notifiable: Notifiable, channel: string): string | number | undefined {
  if (typeof notifiable.routeNotificationFor === "function") {
    const route = notifiable.routeNotificationFor(channel);
    if (route !== undefined && route !== null) return route;
  }
  if (channel === "mail") return notifiable.email as string | undefined;
  return notifiable.id as number | undefined;
}

/** The bridge that actually delivers a notification on one channel. */
export interface Channel {
  send(notifiable: Notifiable, notification: Notification): Promise<void>;
}

/* -------------------------------- channels -------------------------------- */

/** Delivers via the mailer, using the notification's `toMail`. */
export class MailChannel implements Channel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toMail) {
      throw new Error(`${notification.constructor.name} has no toMail() for the mail channel.`);
    }
    const content = notification.toMail(notifiable);
    const to = content.to ?? routeFor(notifiable, "mail");
    if (!to) {
      throw new Error("Notification: no mail route (set `email` or `routeNotificationFor`).");
    }

    const message = getMailer().message().to(String(to)).subject(content.subject);
    if (content.from) message.from(content.from);
    if (content.text) message.text(content.text);
    if (content.html) message.html(content.html);
    await message.send();
  }
}

/** Persists the notification's `toArray` payload to a table via the query builder. */
export class DatabaseChannel implements Channel {
  constructor(private table = "notifications") {}

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const data = notification.toArray ? notification.toArray(notifiable) : {};
    await db(this.table).insert({
      type: notification.constructor.name,
      notifiable_id: routeFor(notifiable, "database") ?? null,
      data: JSON.stringify(data),
    });
  }
}

/** Collects deliveries in memory — for tests. */
export class ArrayChannel implements Channel {
  readonly sent: { notifiable: Notifiable; notification: Notification }[] = [];
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    this.sent.push({ notifiable, notification });
  }
}

/* -------------------------------- notifier -------------------------------- */

export class Notifier {
  private channels = new Map<string, Channel>([["mail", new MailChannel()]]);

  /** Register (or replace) a channel by name. */
  channel(name: string, channel: Channel): this {
    this.channels.set(name, channel);
    return this;
  }

  private async deliver(notifiable: Notifiable, notification: Notification): Promise<void> {
    for (const name of notification.via(notifiable)) {
      const channel = this.channels.get(name);
      if (!channel) throw new Error(`No notification channel "${name}" registered.`);
      await channel.send(notifiable, notification);
    }
  }

  /** Send a notification to one or many recipients. */
  async send(
    notifiables: Notifiable | Notifiable[],
    notification: Notification,
  ): Promise<void> {
    const recipients = Array.isArray(notifiables) ? notifiables : [notifiables];
    const run = async () => {
      for (const recipient of recipients) {
        await this.deliver(recipient, notification);
        const requestId = currentRequestId();
        instrument("notification.sent", {
          notification: notification.constructor.name,
          channels: notification.via(recipient),
          notifiable: recipient,
          ...(requestId ? { requestId } : {}),
        });
      }
    };
    if (notification.shouldQueue) await dispatch(run);
    else await run();
  }
}

/* --------------------------------- global --------------------------------- */

let notifier = new Notifier();

/** Register the default notifier used by `notify()`. */
export function setNotifier(instance: Notifier): Notifier {
  notifier = instance;
  return notifier;
}

/** The default notifier instance (register channels on it). */
export function getNotifier(): Notifier {
  return notifier;
}

/** Send a notification to one or many notifiables via the default notifier. */
export function notify(
  notifiables: Notifiable | Notifiable[],
  notification: Notification,
): Promise<void> {
  return notifier.send(notifiables, notification);
}
