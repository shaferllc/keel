// Type-check harness for docs/billing.md. Compile-only — never executed.
import { Model, listen } from "@shaferllc/keel/core";
import {
  Billable,
  BillingServiceProvider,
  BillingManager,
  FakeGateway,
  setBilling,
  resolveBillableUsing,
  type CheckoutSession,
  type GatewayCharge,
} from "@shaferllc/keel/billing";

export class User extends Billable(Model) {
  static override table = "users";
  declare id: number;
  declare email: string;
  declare name: string;
}

declare const user: User;
declare const paymentMethodId: string;
declare const successUrl: string;
declare const cancelUrl: string;

export const providers = [BillingServiceProvider];

/* -------------------------------- customers ------------------------------- */

export async function customers() {
  await user.createAsCustomer();
  user.hasBillingId();
  await user.getCustomerId();
}

/* ------------------------------ subscriptions ----------------------------- */

export async function subscribe() {
  await user
    .newSubscription("default", "price_pro")
    .trialDays(14)
    .quantity(3)
    .create(paymentMethodId);

  const session: CheckoutSession = await user
    .newSubscription("default", "price_pro")
    .checkout({ successUrl, cancelUrl });
  return session;
}

export async function status() {
  await user.subscribed();
  await user.subscribedToPrice("price_pro");
  await user.onTrial();
  const sub = await user.subscription();
  if (!sub) return;

  sub.active();
  sub.onTrial();
  sub.recurring();
  sub.canceled();
  sub.onGracePeriod();
  sub.ended();
  sub.paused();
  sub.valid();
  sub.hasIncompletePayment();

  await sub.swap("price_enterprise");
  await sub.updateQuantity(10);
  await sub.incrementQuantity(2);
  await sub.decrementQuantity();
  await sub.cancel();
  await sub.resume();
  await sub.cancelNow();
  await sub.endTrial();
  await sub.extendTrial(new Date("2026-01-01"));
}

/* -------------------------------- charges --------------------------------- */

export async function charges() {
  const charge: GatewayCharge = await user.charge(2000, {
    paymentMethod: "pm_1",
    description: "Credits",
  });
  await user.refund(charge.id);
  await user.refund(charge.id, 500);
  await user.checkout("price_onetime", { successUrl, cancelUrl });
  await user.createSetupIntent();
  await user.paymentMethods();
  await user.invoices();
}

/* -------------------------------- webhooks -------------------------------- */

export function webhooks() {
  listen("billing.subscription.updated", (e) => {
    void e.gateway;
    void e.subscriptionId;
  });
  listen("billing.webhook.received", (e) => {
    void e.gateway;
    void e.type;
  });
  resolveBillableUsing(async (customerId, _gateway) => {
    return { id: user.id, type: "User" };
  });
}

/* --------------------------------- testing -------------------------------- */

export function fakeGateway() {
  const fake = new FakeGateway();
  const manager = new BillingManager({
    default: "fake",
    currency: "usd",
    billableModel: "User",
    webhook: { path: "billing/webhook" },
    gateways: {
      stripe: { key: "", webhookSecret: "" },
      paddle: { key: "", webhookSecret: "" },
      fake: {},
    },
  });
  manager.register("fake", () => fake);
  setBilling(manager);
  return fake;
}
