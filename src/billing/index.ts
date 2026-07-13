/**
 * Keel Billing — public surface, imported from `@shaferllc/keel/billing`.
 *
 *   import { BillingServiceProvider, Billable } from "@shaferllc/keel/billing";
 *   class User extends Billable(Model) { static table = "users"; }
 */

import "./events.js"; // load the EventsList augmentation

export { BillingServiceProvider } from "./provider.js";

export { Billable } from "./billable.js";
export type { ChargeOptions, ProductCheckoutOptions } from "./billable.js";

export { Subscription, toRefs } from "./subscription.js";
export type { PriceArg } from "./subscription.js";
export { SubscriptionItem } from "./subscription-item.js";
export { SubscriptionBuilder } from "./builder.js";
export type { BillableTarget, CheckoutOptions } from "./builder.js";

export { BillingManager, billing, setBilling } from "./manager.js";
export type { GatewayFactory } from "./manager.js";

export { BillingError } from "./gateway.js";
export type {
  BillingGateway,
  HeaderBag,
  CustomerDetails,
  GatewayCustomer,
  PriceRef,
  CreateSubscriptionParams,
  GatewaySubscription,
  GatewaySubscriptionItem,
  SwapParams,
  CancelParams,
  ChargeParams,
  GatewayCharge,
  RefundParams,
  GatewayRefund,
  GatewayInvoice,
  CheckoutParams,
  CheckoutSession,
  SetupIntent,
  PaymentMethod,
  BillingPortalSession,
  WebhookEvent,
} from "./gateway.js";

export { registerDefaultGateways, StripeGateway, PaddleGateway, FakeGateway } from "./drivers/index.js";
export type { FakeCall } from "./drivers/index.js";

export { handleWebhook, resolveBillableUsing } from "./webhooks.js";
export type { WebhookResult, BillableResolver } from "./webhooks.js";

export { registerBillingRoutes } from "./routes.js";
export { billingMigration } from "./migration.js";

export { defaultConfig, resolveConfig } from "./config.js";
export type { BillingConfig, StripeGatewayConfig, PaddleGatewayConfig } from "./config.js";
export type { SubscriptionEvent, WebhookReceivedEvent } from "./events.js";
