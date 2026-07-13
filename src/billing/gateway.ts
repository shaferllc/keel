/**
 * The gateway seam. `BillingGateway` is the one interface every payment
 * provider implements — Stripe, Paddle, or the in-memory Fake used in tests.
 * Everything above it (the `Billable` mixin, the `Subscription` model, the
 * webhook handler) is written against these gateway-neutral DTOs and never
 * touches a provider SDK.
 *
 * Money is always an integer in the smallest currency unit (cents), matching
 * both Stripe and Paddle. Dates are real `Date`s. Provider-specific identifiers
 * are opaque strings.
 *
 * Optional methods (`createSetupIntent`, `paymentMethods`) are capabilities not
 * every gateway has — Paddle is hosted-checkout and never sees a raw card. The
 * `Billable` mixin throws a `BillingError` when the active gateway lacks one.
 */

/** A lookup over request headers (Hono's `c.req.header` satisfies this). */
export type HeaderBag = (name: string) => string | undefined | null;

/** Customer details we sync up to the gateway. */
export interface CustomerDetails {
  name?: string;
  email?: string;
  metadata?: Record<string, string>;
}

export interface GatewayCustomer {
  id: string;
  email?: string;
  name?: string;
}

/** A price and how many of it — one line of a subscription. */
export interface PriceRef {
  price: string;
  quantity?: number;
}

export interface CreateSubscriptionParams {
  customer: string;
  items: PriceRef[];
  /** Absolute trial end; omit for no trial. */
  trialEnd?: Date;
  /** A payment method to bill (Stripe pm id). */
  paymentMethod?: string;
  metadata?: Record<string, string>;
}

export interface GatewaySubscriptionItem {
  id: string;
  product: string;
  price: string;
  quantity?: number;
}

/** The normalized shape a gateway returns for any subscription read/write. */
export interface GatewaySubscription {
  id: string;
  /** Provider status verbatim (`active`, `trialing`, `past_due`, `paused`, …). */
  status: string;
  items: GatewaySubscriptionItem[];
  quantity?: number | null;
  trialEndsAt?: Date | null;
  /** When a cancel-at-period-end subscription actually ends (the grace period). */
  endsAt?: Date | null;
  /** The gateway customer this subscription belongs to, when known. */
  customer?: string;
}

export interface SwapParams {
  items: PriceRef[];
  /** Prorate the change; gateways default to true. */
  prorate?: boolean;
}

export interface CancelParams {
  /** Cancel immediately instead of at period end. */
  now?: boolean;
}

export interface ChargeParams {
  customer: string;
  amount: number;
  currency?: string;
  paymentMethod?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface GatewayCharge {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export interface RefundParams {
  /** The charge or payment-intent id to refund. */
  charge: string;
  /** Partial amount; omit to refund in full. */
  amount?: number;
}

export interface GatewayRefund {
  id: string;
  amount: number;
  status: string;
}

export interface GatewayInvoice {
  id: string;
  number?: string | null;
  total: number;
  currency: string;
  status: string;
  date?: Date | null;
  /** Hosted invoice / PDF url when the gateway exposes one. */
  url?: string | null;
}

export interface CheckoutParams {
  mode: "subscription" | "payment";
  customer?: string;
  items: PriceRef[];
  successUrl?: string;
  cancelUrl?: string;
  trialEnd?: Date;
  metadata?: Record<string, string>;
  allowPromotionCodes?: boolean;
}

/** A hosted checkout handle: a redirect `url` (Stripe) or a `clientToken` (Paddle). */
export interface CheckoutSession {
  id: string;
  url?: string | null;
  clientToken?: string | null;
  raw?: unknown;
}

export interface SetupIntent {
  id: string;
  clientSecret: string | null;
}

export interface PaymentMethod {
  id: string;
  type: string;
  last4?: string | null;
  brand?: string | null;
}

/**
 * A verified inbound webhook, normalized. When the event concerns a
 * subscription the gateway extracts it into `subscription` so the webhook
 * handler can upsert local state without any provider-specific parsing.
 */
export interface WebhookEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  subscription?: GatewaySubscription;
  customer?: string;
}

export interface BillingGateway {
  /** The registry name — "stripe", "paddle", "fake". */
  readonly name: string;

  createCustomer(details: CustomerDetails): Promise<GatewayCustomer>;
  updateCustomer(id: string, details: CustomerDetails): Promise<GatewayCustomer>;

  createSubscription(params: CreateSubscriptionParams): Promise<GatewaySubscription>;
  swapSubscription(id: string, params: SwapParams): Promise<GatewaySubscription>;
  updateQuantity(
    id: string,
    quantity: number,
    opts?: { prorate?: boolean },
  ): Promise<GatewaySubscription>;
  cancelSubscription(id: string, params?: CancelParams): Promise<GatewaySubscription>;
  resumeSubscription(id: string): Promise<GatewaySubscription>;

  charge(params: ChargeParams): Promise<GatewayCharge>;
  refund(params: RefundParams): Promise<GatewayRefund>;
  listInvoices(customer: string): Promise<GatewayInvoice[]>;

  createCheckoutSession(params: CheckoutParams): Promise<CheckoutSession>;

  /** Verify a raw webhook body + headers against `secret`; null if unrecognized. */
  verifyWebhook(
    rawBody: string,
    headers: HeaderBag,
    secret: string,
  ): Promise<WebhookEvent | null>;

  /* -------- optional capabilities (not every gateway supports these) -------- */

  createSetupIntent?(customer: string): Promise<SetupIntent>;
  paymentMethods?(customer: string): Promise<PaymentMethod[]>;
  /** Hosted customer portal (manage card / cancel). Stripe-style. */
  createBillingPortalSession?(
    customer: string,
    returnUrl: string,
  ): Promise<BillingPortalSession>;
}

/** A hosted billing-portal redirect. */
export interface BillingPortalSession {
  id: string;
  url: string;
}

/** Raised for gateway/config problems and unsupported-capability calls. */
export class BillingError extends Error {
  constructor(
    message: string,
    readonly gateway?: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}
