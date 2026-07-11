// Type-check harness for docs/notifications.md. Every type-checkable snippet in
// the guide is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import {
  Notification,
  Notifier,
  MailChannel,
  DatabaseChannel,
  ArrayChannel,
  routeFor,
  notify,
  setNotifier,
  getNotifier,
  type Notifiable,
  type MailContent,
  type Channel,
} from "@shaferllc/keel/core";

declare const user: Notifiable;
declare const alice: Notifiable;
declare const bob: Notifiable;

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

export class QueuedInvoicePaid extends Notification {
  shouldQueue = true;
  via() {
    return ["array"];
  }
  toArray() {
    return {};
  }
}

export async function sending() {
  await notify(user, new InvoicePaid(4200));
  await notify([alice, bob], new InvoicePaid(4200));
}

export function routing() {
  const mail = routeFor(user, "mail");
  const dbId = routeFor(user, "database");
  return { mail, dbId };
}

export function registerChannels() {
  setNotifier(new Notifier().channel("database", new DatabaseChannel()));
  getNotifier().channel("slack", slack);
}

// A custom channel — the illustrative Slack snippet, compiling.
export const slack: Channel = {
  async send(notifiable, notification) {
    const payload = notification.toArray?.(notifiable) ?? {};
    void payload;
    // POST payload to a Slack webhook via fetch…
  },
};

export async function customChannel() {
  setNotifier(new Notifier().channel("slack", slack));
}

export async function inTests() {
  const array = new ArrayChannel();
  setNotifier(new Notifier().channel("array", array));

  await notify(user, new QueuedInvoicePaid());

  const first = array.sent[0];
  return { count: array.sent.length, notification: first?.notification };
}

// API-reference entries
export async function reference() {
  await notify(user, new InvoicePaid(4200));
  setNotifier(new Notifier().channel("database", new DatabaseChannel()));
  getNotifier().channel("slack", slack);

  routeFor(user, "mail");
  routeFor(user, "database");

  const notifier = new Notifier()
    .channel("database", new DatabaseChannel())
    .channel("array", new ArrayChannel());
  await notifier.send(user, new InvoicePaid(4200));
  await new Notifier().send(user, new InvoicePaid(4200));

  new DatabaseChannel();
  new DatabaseChannel("alerts");

  await new MailChannel().send(user, new InvoicePaid(4200));
  await new DatabaseChannel().send(user, new InvoicePaid(4200));

  const arrayChannel = new ArrayChannel();
  await arrayChannel.send(user, new InvoicePaid(4200));
  return arrayChannel.sent[0]?.notification;
}

// Interface / type seams
const content: MailContent = {
  subject: "Welcome",
  html: "<h1>Hi</h1>",
  to: "override@app.com",
};

const channel: Channel = {
  async send(_notifiable, _notification) {},
};

export { content, channel };
