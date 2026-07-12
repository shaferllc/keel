/**
 * An in-memory gateway for tests and local development. It implements the whole
 * `BillingGateway` surface deterministically (ids are sequential, no clock or
 * randomness in the identifiers) and records every call on `.calls` so tests can
 * assert what the higher layers asked of it — the billing analogue of
 * `MemoryDriver`/`ArrayTransport`.
 *
 *   const gw = new FakeGateway();
 *   manager.register("fake", () => gw);
 *   // …exercise Billable…
 *   gw.calls.filter((c) => c.method === "charge");
 *
 * Webhooks are signed exactly like a real gateway: HMAC-SHA256 hex of the raw
 * body under the secret, in a `fake-signature` header. `signWebhook()` builds a
 * matching body+headers pair for tests.
 */

import { hmacSha256Hex, constantTimeEqual } from "../crypto.js";
import type {
  BillingGateway,
  CustomerDetails,
  GatewayCustomer,
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
  HeaderBag,
  PriceRef,
} from "../gateway.js";

export interface FakeCall {
  method: string;
  args: unknown[];
}

const DAY = 86_400_000;

export class FakeGateway implements BillingGateway {
  readonly name = "fake";

  readonly calls: FakeCall[] = [];
  readonly customers = new Map<string, GatewayCustomer>();
  readonly subscriptions = new Map<string, GatewaySubscription>();
  readonly invoices = new Map<string, GatewayInvoice[]>();

  private seq = 0;
  private id(prefix: string): string {
    return `${prefix}_${++this.seq}`;
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  private items(refs: PriceRef[]): GatewaySubscriptionItem[] {
    return refs.map((r) => ({
      id: this.id("si"),
      product: `prod_${r.price}`,
      price: r.price,
      quantity: r.quantity ?? 1,
    }));
  }

  async createCustomer(details: CustomerDetails): Promise<GatewayCustomer> {
    this.record("createCustomer", details);
    const customer: GatewayCustomer = {
      id: this.id("cus"),
      email: details.email,
      name: details.name,
    };
    this.customers.set(customer.id, customer);
    return customer;
  }

  async updateCustomer(id: string, details: CustomerDetails): Promise<GatewayCustomer> {
    this.record("updateCustomer", id, details);
    const customer: GatewayCustomer = { ...this.customers.get(id), id, ...details };
    this.customers.set(id, customer);
    return customer;
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<GatewaySubscription> {
    this.record("createSubscription", params);
    const trialing = params.trialEnd ? params.trialEnd.getTime() > Date.now() : false;
    const items = this.items(params.items);
    const sub: GatewaySubscription = {
      id: this.id("sub"),
      status: trialing ? "trialing" : "active",
      items,
      quantity: items[0]?.quantity ?? 1,
      trialEndsAt: params.trialEnd ?? null,
      endsAt: null,
      customer: params.customer,
    };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  async swapSubscription(id: string, params: SwapParams): Promise<GatewaySubscription> {
    this.record("swapSubscription", id, params);
    const sub = this.require(id);
    const items = this.items(params.items);
    const next: GatewaySubscription = { ...sub, items, quantity: items[0]?.quantity ?? 1 };
    this.subscriptions.set(id, next);
    return next;
  }

  async updateQuantity(
    id: string,
    quantity: number,
    opts?: { prorate?: boolean },
  ): Promise<GatewaySubscription> {
    this.record("updateQuantity", id, quantity, opts);
    const sub = this.require(id);
    const items = sub.items.map((it, i) => (i === 0 ? { ...it, quantity } : it));
    const next: GatewaySubscription = { ...sub, items, quantity };
    this.subscriptions.set(id, next);
    return next;
  }

  async cancelSubscription(id: string, params?: CancelParams): Promise<GatewaySubscription> {
    this.record("cancelSubscription", id, params);
    const sub = this.require(id);
    const now = new Date();
    const next: GatewaySubscription = params?.now
      ? { ...sub, status: "canceled", endsAt: now }
      : { ...sub, endsAt: new Date(now.getTime() + 30 * DAY) };
    this.subscriptions.set(id, next);
    return next;
  }

  async resumeSubscription(id: string): Promise<GatewaySubscription> {
    this.record("resumeSubscription", id);
    const sub = this.require(id);
    const trialing = sub.trialEndsAt ? sub.trialEndsAt.getTime() > Date.now() : false;
    const next: GatewaySubscription = {
      ...sub,
      status: trialing ? "trialing" : "active",
      endsAt: null,
    };
    this.subscriptions.set(id, next);
    return next;
  }

  async charge(params: ChargeParams): Promise<GatewayCharge> {
    this.record("charge", params);
    return {
      id: this.id("ch"),
      status: "succeeded",
      amount: params.amount,
      currency: params.currency ?? "usd",
    };
  }

  async refund(params: RefundParams): Promise<GatewayRefund> {
    this.record("refund", params);
    return { id: this.id("re"), amount: params.amount ?? 0, status: "succeeded" };
  }

  async listInvoices(customer: string): Promise<GatewayInvoice[]> {
    this.record("listInvoices", customer);
    return this.invoices.get(customer) ?? [];
  }

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutSession> {
    this.record("createCheckoutSession", params);
    const id = this.id("cs");
    return { id, url: `https://fake.checkout/${id}`, clientToken: `ctok_${id}` };
  }

  async createSetupIntent(customer: string): Promise<SetupIntent> {
    this.record("createSetupIntent", customer);
    const id = this.id("seti");
    return { id, clientSecret: `${id}_secret` };
  }

  async paymentMethods(customer: string): Promise<PaymentMethod[]> {
    this.record("paymentMethods", customer);
    return [{ id: this.id("pm"), type: "card", last4: "4242", brand: "visa" }];
  }

  async verifyWebhook(
    rawBody: string,
    headers: HeaderBag,
    secret: string,
  ): Promise<import("../gateway.js").WebhookEvent | null> {
    const provided = headers("fake-signature") ?? "";
    const expected = await hmacSha256Hex(secret, rawBody);
    if (!constantTimeEqual(provided, expected)) return null;

    const body = JSON.parse(rawBody) as {
      id?: string;
      type: string;
      data?: Partial<GatewaySubscription> & { customer?: string };
    };
    const data = body.data;
    const subscription =
      data && data.id
        ? ({
            id: data.id,
            status: data.status ?? "active",
            items: data.items ?? [],
            quantity: data.quantity ?? null,
            trialEndsAt: data.trialEndsAt ? new Date(data.trialEndsAt) : null,
            endsAt: data.endsAt ? new Date(data.endsAt) : null,
            customer: data.customer,
          } satisfies GatewaySubscription)
        : undefined;
    return {
      id: body.id ?? this.id("evt"),
      type: body.type,
      payload: body as Record<string, unknown>,
      subscription,
      customer: data?.customer,
    };
  }

  /** Build a signed webhook body + headers pair for tests. */
  async signWebhook(
    secret: string,
    event: { id?: string; type: string; data?: Record<string, unknown> },
  ): Promise<{ body: string; headers: Record<string, string> }> {
    const body = JSON.stringify(event);
    const signature = await hmacSha256Hex(secret, body);
    return { body, headers: { "fake-signature": signature } };
  }

  private require(id: string): GatewaySubscription {
    const sub = this.subscriptions.get(id);
    if (sub) return sub;
    // Not created through this instance (e.g. hydrated from a fixture) — mint a
    // minimal record so lifecycle calls still resolve.
    const seed: GatewaySubscription = {
      id,
      status: "active",
      items: [],
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
    };
    this.subscriptions.set(id, seed);
    return seed;
  }
}
