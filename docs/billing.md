# Billing

Keel Billing is a subscription-billing layer — a port of [Laravel
Cashier](https://laravel.com/docs/13.x/billing) — for charging customers,
managing subscriptions, and reconciling gateway state through webhooks. It ships
as a Keel [package](./packages.md) and supports two gateways behind one API:
**Stripe** and **Paddle**.

It attaches to a model with a mixin. Your `User` becomes billable, gains a
gateway customer, and can create subscriptions and charges:

```ts
import { Model } from "@shaferllc/keel/core";
import { Billable } from "@shaferllc/keel/billing";

export class User extends Billable(Model) {
  static table = "users";
  declare email: string;
}
```

## Install

```ts
// bootstrap/providers.ts
import { BillingServiceProvider } from "@shaferllc/keel/billing";

export const providers = [AppServiceProvider, BillingServiceProvider];
```

Publish the config and create the tables:

```bash
keel vendor:publish --tag billing-config   # writes config/billing.ts
keel migrate                               # creates subscriptions + subscription_items,
                                           # and adds billing columns to users
```

Set your keys in `.env`:

```ini
BILLING_GATEWAY=stripe            # or "paddle"
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Paddle:
PADDLE_API_KEY=...
PADDLE_WEBHOOK_SECRET=...
PADDLE_CLIENT_TOKEN=...
PADDLE_SANDBOX=true
```

## One API, two gateways

Everything you call goes through a gateway-neutral interface, so switching from
Stripe to Paddle is a config change. The active gateway comes from
`config("billing.default")`; a billable can also carry its own in
`billing_gateway`. Money is always an integer in the smallest currency unit
(cents). See [Gateway differences](#gateway-differences) for where Paddle's
merchant-of-record model diverges.

## Customers

A gateway customer is created lazily the first time you need one, but you can
create it up front:

```ts
await user.createAsCustomer();     // creates the customer, stores its id
user.hasBillingId();               // true
await user.getCustomerId();        // the id (creates if missing)
```

Override what gets synced by defining `billingName()` / `billingEmail()` on your
model. By default they read `name` / `email`.

## Subscriptions

Build a subscription with the fluent builder:

```ts
await user
  .newSubscription("default", "price_pro")
  .trialDays(14)
  .quantity(3)
  .create(paymentMethodId);        // paymentMethodId optional if a default is on file
```

Multiple prices (add-ons) are an array; `withMetadata`, `trialUntil`, and
`skipTrial` are also available. To send the customer to a hosted checkout
instead of charging now, swap `.create()` for `.checkout()`:

```ts
const session = await user
  .newSubscription("default", "price_pro")
  .checkout({ successUrl: "...", cancelUrl: "..." });
// Stripe: redirect to session.url. Paddle: open the overlay with session.clientToken.
```

### Status

Status questions are answered from local columns — no gateway round-trip:

```ts
await user.subscribed();                 // valid (active | trial | grace)
await user.subscribedToPrice("price_pro");
await user.onTrial();
const sub = await user.subscription();    // the "default" subscription, or null

sub.active();        sub.onTrial();       sub.recurring();
sub.canceled();      sub.onGracePeriod(); sub.ended();
sub.paused();        sub.valid();         sub.hasIncompletePayment();
```

### Changing a subscription

```ts
await sub.swap("price_enterprise");       // change price(s)
await sub.updateQuantity(10);
await sub.incrementQuantity(2);
await sub.decrementQuantity();
```

Each of these calls the gateway and syncs the result back into the local row.

### Cancelling

```ts
await sub.cancel();       // at period end — access continues through the grace period
await sub.onGracePeriod();// true
await sub.resume();       // revive a subscription still in its grace period
await sub.cancelNow();    // immediately; sub.ended() becomes true
```

### Trials

```ts
await sub.endTrial();
await sub.extendTrial(new Date("2026-01-01"));
user.onGenericTrial();    // a trial_ends_at on the user, before any subscription
```

## Single charges

```ts
const charge = await user.charge(2000, { paymentMethod: "pm_1", description: "Credits" });
await user.refund(charge.id);          // full refund
await user.refund(charge.id, 500);     // partial

const session = await user.checkout("price_onetime", { successUrl, cancelUrl });
```

## Payment methods (Stripe)

Collect a card with a SetupIntent, then create the subscription with the
resulting payment method:

```ts
const intent = await user.createSetupIntent();  // return intent.clientSecret to the front end
const methods = await user.paymentMethods();
```

These are Stripe-only capabilities; calling them on the Paddle gateway throws a
`BillingError` (Paddle collects cards in its own hosted checkout).

## Invoices

```ts
const invoices = await user.invoices();   // GatewayInvoice[] — total, currency, status, url
```

## Webhooks

The package mounts one webhook endpoint per gateway at
`config("billing.webhook.path")`:

```
POST /billing/webhook/stripe
POST /billing/webhook/paddle
```

Point your gateway dashboard at the matching URL. Each request is verified
against the gateway's signing secret (HMAC-SHA256 over the raw body), the local
subscription is synced, and typed events fire:

```ts
import { listen } from "@shaferllc/keel/core";

listen("billing.subscription.updated", (e) => {
  // e.gateway, e.subscriptionId, e.providerId, e.status
});
listen("billing.webhook.received", (e) => { /* e.gateway, e.type, e.id */ });
```

Events: `billing.webhook.received`, `billing.subscription.created` / `.updated`
/ `.deleted`.

An update to a subscription already in your database is always synced. A brand
new subscription born from a Paddle checkout has no local row yet — register a
resolver so the handler can create it:

```ts
import { resolveBillableUsing } from "@shaferllc/keel/billing";

resolveBillableUsing(async (customerId) => {
  const user = (await User.query().where("billing_customer_id", customerId).first());
  return user ? { id: user.id, type: "User" } : null;
});
```

## Gateway differences

| Concern | Stripe | Paddle |
|---------|--------|--------|
| Create a subscription server-side | `create(pmId)` | Not supported — use `checkout()`; the webhook creates the local row |
| One-off `charge()` | Confirms a PaymentIntent | Not supported — use `checkout({ mode })` / transactions |
| SetupIntent / `paymentMethods()` | Supported | Throws `BillingError` (hosted checkout) |
| Checkout handle | `session.url` (redirect) | `session.clientToken` (overlay/inline) |
| Webhook signature | `Stripe-Signature: t=…,v1=…` | `Paddle-Signature: ts=…;h1=…` |

## Schema

The migration is gateway-neutral: `subscriptions` (with `gateway`,
`provider_id`, `provider_status`, `provider_price`, trial/grace timestamps),
`subscription_items`, and columns on `users` (`billing_gateway`,
`billing_customer_id`, `pm_type`, `pm_last_four`, `trial_ends_at`). Cashier
targets the standard `users` billable table.

## Testing

The package ships a `FakeGateway` — an in-memory gateway that records every call
— so you can drive billing without touching a network:

```ts
import { BillingManager, setBilling, FakeGateway } from "@shaferllc/keel/billing";

const fake = new FakeGateway();
const manager = new BillingManager(config);   // config.default = "fake"
manager.register("fake", () => fake);
setBilling(manager);

await user.newSubscription("default", "price_pro").create();
fake.calls.filter((c) => c.method === "createSubscription"); // assert what was asked
```
