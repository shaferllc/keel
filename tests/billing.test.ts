import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { Application } from "../src/core/application.js";
import { Model } from "../src/core/model.js";
import {
  setConnection,
  clearConnections,
  type Connection,
  type Row,
} from "../src/core/database.js";
import { Migrator } from "../src/core/migrations.js";
import { events } from "../src/core/helpers.js";

import { Billable } from "../src/billing/billable.js";
import { Subscription } from "../src/billing/subscription.js";
import { SubscriptionItem } from "../src/billing/subscription-item.js";
import { BillingServiceProvider } from "../src/billing/provider.js";
import { BillingManager, setBilling } from "../src/billing/manager.js";
import { FakeGateway } from "../src/billing/drivers/fake.js";
import { StripeGateway } from "../src/billing/drivers/stripe.js";
import { PaddleGateway } from "../src/billing/drivers/paddle.js";
import { billingMigration } from "../src/billing/migration.js";
import { handleWebhook } from "../src/billing/webhooks.js";
import { hmacSha256Hex, constantTimeEqual } from "../src/billing/crypto.js";
import { BillingError, type BillingConfig } from "../src/billing/index.js";

class User extends Billable(Model) {
  static override table = "users";
  declare id: number;
  declare email: string;
  declare name: string;
}

function fakeConfig(): BillingConfig {
  return {
    default: "fake",
    currency: "usd",
    billableModel: "User",
    webhook: { path: "billing/webhook" },
    gateways: {
      stripe: { key: "", webhookSecret: "" },
      paddle: { key: "", webhookSecret: "" },
      fake: { webhookSecret: "whsec_fake" },
    },
  };
}

/** A real in-memory SQLite connection + a migrated schema + a Fake gateway. */
async function setup(): Promise<{ db: DatabaseSync; fake: FakeGateway }> {
  new Application(); // active app for events()/config()
  clearConnections();

  const db = new DatabaseSync(":memory:");
  const conn: Connection = {
    async select(sql, bindings) {
      return db.prepare(sql).all(...(bindings as never[])) as Row[];
    },
    async write(sql, bindings) {
      const r = db.prepare(sql).run(...(bindings as never[]));
      return { rowsAffected: Number(r.changes), insertId: Number(r.lastInsertRowid) };
    },
  };
  setConnection(conn, "sqlite");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, name TEXT)");
  await new Migrator(conn, "sqlite").up([billingMigration("users")]);

  const fake = new FakeGateway();
  const manager = new BillingManager(fakeConfig());
  manager.register("fake", () => fake);
  setBilling(manager);

  return { db, fake };
}

test("createAsCustomer stores the gateway id and getCustomerId is idempotent", async () => {
  const { fake } = await setup();
  const user = await User.create({ email: "ada@x.com", name: "Ada" });

  assert.equal(user.hasBillingId(), false);
  const id = await user.getCustomerId();
  assert.match(id, /^cus_/);
  assert.equal(user.billing_customer_id, id);
  assert.equal(user.billing_gateway, "fake");

  // A second call reuses the stored id — only one createCustomer hit the gateway.
  const again = await user.getCustomerId();
  assert.equal(again, id);
  assert.equal(fake.calls.filter((c) => c.method === "createCustomer").length, 1);
});

test("newSubscription creates a subscription with a trial, item, and live status", async () => {
  await setup();
  const user = await User.create({ email: "grace@x.com", name: "Grace" });

  const sub = await user.newSubscription("default", "price_pro").trialDays(14).create("pm_1");

  assert.equal(sub.provider_status, "trialing");
  assert.equal(sub.onTrial(), true);
  assert.equal(sub.active(), true);
  assert.equal(sub.valid(), true);
  assert.deepEqual(sub.provider_price, ["price_pro"]);

  assert.equal(await user.subscribed(), true);
  assert.equal(await user.subscribedToPrice("price_pro"), true);

  const items = await SubscriptionItem.query().where("subscription_id", sub.id).get();
  assert.equal(items.length, 1);
  assert.equal(items[0]!.provider_price, "price_pro");
});

test("swap and quantity changes sync back from the gateway", async () => {
  await setup();
  const user = await User.create({ email: "swap@x.com" });
  const sub = await user.newSubscription("default", "price_basic").create();

  await sub.swap("price_pro");
  assert.equal(sub.hasPrice("price_pro"), true);
  assert.equal(sub.hasPrice("price_basic"), false);

  await sub.updateQuantity(5);
  assert.equal(sub.quantity, 5);
  await sub.incrementQuantity(2);
  assert.equal(sub.quantity, 7);
  await sub.decrementQuantity(3);
  assert.equal(sub.quantity, 4);
});

test("cancel puts a subscription in grace period; resume revives it; cancelNow ends it", async () => {
  await setup();
  const user = await User.create({ email: "cancel@x.com" });
  const sub = await user.newSubscription("default", "price_pro").skipTrial().create();
  assert.equal(sub.active(), true);

  await sub.cancel();
  assert.equal(sub.canceled(), true);
  assert.equal(sub.onGracePeriod(), true);
  assert.equal(sub.ended(), false);
  assert.equal(sub.valid(), true); // still usable during grace

  await sub.resume();
  assert.equal(sub.canceled(), false);
  assert.equal(sub.active(), true);

  await sub.cancelNow();
  assert.equal(sub.ended(), true);
  assert.equal(sub.active(), false);
  assert.equal(sub.valid(), false);
});

test("charge and refund reach the gateway with the right arguments", async () => {
  const { fake } = await setup();
  const user = await User.create({ email: "pay@x.com" });

  const charge = await user.charge(2500, { paymentMethod: "pm_9", description: "Credits" });
  assert.equal(charge.amount, 2500);
  assert.equal(charge.status, "succeeded");

  const chargeCall = fake.calls.find((c) => c.method === "charge");
  assert.ok(chargeCall);
  assert.equal((chargeCall!.args[0] as { amount: number }).amount, 2500);

  const refund = await user.refund(charge.id, 500);
  assert.equal(refund.amount, 500);
});

test("billingPortal opens a hosted customer portal session", async () => {
  const { fake } = await setup();
  const user = await User.create({ email: "portal@x.com" });

  const session = await user.billingPortal("https://app.example.com/billing");
  assert.match(session.id, /^bps_/);
  assert.match(session.url, /^https:\/\/fake\.portal\//);
  assert.match(session.url, /return=/);

  const call = fake.calls.find((c) => c.method === "createBillingPortalSession");
  assert.ok(call);
  assert.equal(call!.args[1], "https://app.example.com/billing");
});

test("webhook verifies, upserts the subscription, and emits an event", async () => {
  const { fake } = await setup();
  const user = await User.create({ email: "hook@x.com" });
  const sub = await user.newSubscription("default", "price_pro").skipTrial().create();

  // Capture emitted events.
  const buffer = events().fake();

  // The gateway now reports the subscription as canceled at period end.
  const signed = await fake.signWebhook("whsec_fake", {
    id: "evt_1",
    type: "subscription.updated",
    data: {
      id: sub.provider_id,
      status: "active",
      items: [{ id: "si_x", product: "prod_pro", price: "price_pro", quantity: 1 }],
      endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      customer: user.billing_customer_id,
    },
  });

  const result = await handleWebhook("fake", signed.body, (n) => signed.headers[n]);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);

  buffer.assertEmitted("billing.webhook.received");
  buffer.assertEmitted("billing.subscription.updated");

  // Local state reflects the webhook.
  const reloaded = await Subscription.findOrFail(sub.id);
  assert.equal((reloaded as Subscription).onGracePeriod(), true);
});

test("webhook with a bad signature is rejected 400", async () => {
  await setup();
  const result = await handleWebhook("fake", '{"type":"x"}', () => "deadbeef");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("hmacSha256Hex matches a known RFC-style vector; constantTimeEqual works", async () => {
  const mac = await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog");
  assert.equal(mac, "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});

test("Stripe verifyWebhook validates the t/v1 signature and normalizes the subscription", async () => {
  const secret = "whsec_stripe";
  const stripeSub = {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    cancel_at_period_end: true,
    current_period_end: 1_893_456_000,
    items: { data: [{ id: "si_1", quantity: 2, price: { id: "price_1", product: "prod_1" } }] },
  };
  const event = { id: "evt_1", type: "customer.subscription.updated", data: { object: stripeSub } };
  const body = JSON.stringify(event);
  const t = "1700000000";
  const v1 = await hmacSha256Hex(secret, `${t}.${body}`);
  const headers = (n: string) => (n === "stripe-signature" ? `t=${t},v1=${v1}` : undefined);

  const gw = new StripeGateway("sk_test");
  const result = await gw.verifyWebhook(body, headers, secret);
  assert.ok(result);
  assert.equal(result!.type, "customer.subscription.updated");
  assert.equal(result!.subscription!.id, "sub_1");
  assert.equal(result!.subscription!.items[0]!.price, "price_1");
  assert.equal(result!.subscription!.quantity, 2);
  assert.deepEqual(result!.subscription!.endsAt, new Date(1_893_456_000 * 1000));

  // A tampered body fails.
  assert.equal(await gw.verifyWebhook(body + " ", headers, secret), null);
});

test("Paddle verifyWebhook validates ts/h1 and maps scheduled cancellation to endsAt", async () => {
  const secret = "pdl_ntf";
  const paddleSub = {
    id: "sub_p",
    status: "active",
    customer_id: "ctm_1",
    scheduled_change: { action: "cancel", effective_at: "2030-01-01T00:00:00.000Z" },
    items: [{ quantity: 1, price: { id: "pri_1", product_id: "pro_1" } }],
  };
  const event = { event_id: "evt_p", event_type: "subscription.updated", data: paddleSub };
  const body = JSON.stringify(event);
  const ts = "1700000000";
  const h1 = await hmacSha256Hex(secret, `${ts}:${body}`);
  const headers = (n: string) => (n === "paddle-signature" ? `ts=${ts};h1=${h1}` : undefined);

  const gw = new PaddleGateway("pdl_key");
  const result = await gw.verifyWebhook(body, headers, secret);
  assert.ok(result);
  assert.equal(result!.subscription!.id, "sub_p");
  assert.equal(result!.subscription!.customer, "ctm_1");
  assert.deepEqual(result!.subscription!.endsAt, new Date("2030-01-01T00:00:00.000Z"));
});

test("the provider registers the per-gateway webhook route", () => {
  const app = new Application();
  const provider = new BillingServiceProvider(app);
  provider.register();
  provider.boot();
  assert.equal(app.router().url("webhook", { gateway: "stripe" }), "/billing/webhook/stripe");
});

test("Paddle rejects server-side subscription creation and direct charges", () => {
  const gw = new PaddleGateway("pdl_key");
  assert.throws(
    () => gw.createSubscription({ customer: "ctm_1", items: [{ price: "pri_1" }] }),
    (e) => e instanceof BillingError,
  );
  assert.throws(
    () => gw.charge({ customer: "ctm_1", amount: 1000 }),
    (e) => e instanceof BillingError,
  );
});
