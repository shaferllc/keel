import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Notification,
  Notifier,
  ArrayChannel,
  DatabaseChannel,
  notify,
  setNotifier,
  getNotifier,
  routeFor,
  type Notifiable,
  type MailContent,
} from "../src/core/notification.js";
import { setMailer, ArrayTransport } from "../src/core/mail.js";
import { setQueue, SyncDriver, MemoryDriver, work } from "../src/core/queue.js";
import { setConnection, type Connection } from "../src/core/database.js";

class InvoicePaid extends Notification {
  constructor(private amount: number) {
    super();
  }
  via(): string[] {
    return ["mail"];
  }
  toMail(): MailContent {
    return { subject: "Payment received", text: `Thanks for $${this.amount}.` };
  }
  toArray() {
    return { amount: this.amount };
  }
}

test("mail channel sends via the mailer, routed by the notifiable's email", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "billing@app.com" });
  setNotifier(new Notifier());
  setQueue(new SyncDriver());

  await notify({ email: "ada@example.com" }, new InvoicePaid(4200));

  assert.equal(transport.sent.length, 1);
  assert.deepEqual(transport.sent[0]!.to, ["ada@example.com"]);
  assert.equal(transport.sent[0]!.subject, "Payment received");
  assert.equal(transport.sent[0]!.text, "Thanks for $4200.");
  assert.equal(transport.sent[0]!.from, "billing@app.com");
});

test("routeNotificationFor overrides the default route", () => {
  const notifiable: Notifiable = {
    email: "default@x.com",
    routeNotificationFor: (channel) => (channel === "mail" ? "override@x.com" : undefined),
  };
  assert.equal(routeFor(notifiable, "mail"), "override@x.com");
  assert.equal(routeFor({ email: "plain@x.com" }, "mail"), "plain@x.com");
  assert.equal(routeFor({ id: 9 }, "database"), 9);
});

test("array channel captures notifiable + notification for assertions", async () => {
  const array = new ArrayChannel();
  setNotifier(new Notifier().channel("array", array));

  class Ping extends Notification {
    via() {
      return ["array"];
    }
  }
  const ping = new Ping();
  const user = { id: 1, email: "a@b.com" };
  await notify(user, ping);

  assert.equal(array.sent.length, 1);
  assert.equal(array.sent[0]!.notifiable, user);
  assert.equal(array.sent[0]!.notification, ping);
});

test("database channel writes the toArray payload", async () => {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const conn = {
    select: async () => [],
    write: async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      return { rowsAffected: 1, insertId: 1 };
    },
  } as Connection;
  setConnection(conn, "sqlite");
  setNotifier(new Notifier().channel("database", new DatabaseChannel()));

  class Stored extends InvoicePaid {
    via() {
      return ["database"];
    }
  }
  await notify({ id: 7 }, new Stored(99));

  assert.match(calls[0]!.sql, /INSERT INTO notifications \(type, notifiable_id, data\)/);
  assert.deepEqual(calls[0]!.bindings, ["Stored", 7, '{"amount":99}']);
});

test("a notification delivers on multiple channels", async () => {
  const transport = new ArrayTransport();
  setMailer(transport, { from: "billing@app.com" });
  const array = new ArrayChannel();
  setNotifier(new Notifier().channel("array", array));

  class Multi extends InvoicePaid {
    via() {
      return ["mail", "array"];
    }
  }
  await notify({ email: "ada@x.com", id: 1 }, new Multi(10));

  assert.equal(transport.sent.length, 1);
  assert.equal(array.sent.length, 1);
});

test("notify sends to many recipients", async () => {
  const array = new ArrayChannel();
  setNotifier(new Notifier().channel("array", array));
  class Ping extends Notification {
    via() {
      return ["array"];
    }
  }
  await notify([{ id: 1 }, { id: 2 }, { id: 3 }], new Ping());
  assert.equal(array.sent.length, 3);
});

test("shouldQueue defers delivery to the queue", async () => {
  const array = new ArrayChannel();
  setNotifier(new Notifier().channel("array", array));
  const driver = new MemoryDriver();
  setQueue(driver);

  class Queued extends Notification {
    shouldQueue = true;
    via() {
      return ["array"];
    }
  }
  await notify({ id: 1 }, new Queued());

  // queued, not delivered yet
  assert.equal(array.sent.length, 0);
  assert.equal(driver.size, 1);

  await work();
  assert.equal(array.sent.length, 1);
});

test("unknown channel throws", async () => {
  setNotifier(new Notifier());
  setQueue(new SyncDriver());
  class Bad extends Notification {
    via() {
      return ["carrier-pigeon"];
    }
  }
  await assert.rejects(() => notify({ id: 1 }, new Bad()), /channel "carrier-pigeon"/);
});

test("mail channel without a route throws a clear error", async () => {
  setMailer(new ArrayTransport(), { from: "x@y.com" });
  setNotifier(new Notifier());
  setQueue(new SyncDriver());
  await assert.rejects(() => notify({ id: 1 }, new InvoicePaid(1)), /no mail route/);
});

test("getNotifier returns the active notifier", () => {
  const n = new Notifier();
  setNotifier(n);
  assert.equal(getNotifier(), n);
});
