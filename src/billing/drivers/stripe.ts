/**
 * The Stripe gateway. Talks to the Stripe REST API directly with `fetch` —
 * form-encoded bodies, Bearer auth, no SDK — matching how the rest of Keel makes
 * outbound calls. Everything is mapped to/from the gateway-neutral DTOs so the
 * layers above never see a Stripe object.
 *
 * Amounts are already in the smallest currency unit; Stripe's `trial_end` is a
 * Unix timestamp; webhook signatures are the `t`/`v1` scheme over the raw body.
 */

import { hmacSha256Hex, constantTimeEqual } from "../crypto.js";
import { BillingError } from "../gateway.js";
import type {
  BillingGateway,
  CustomerDetails,
  GatewayCustomer,
  CreateSubscriptionParams,
  GatewaySubscription,
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
  WebhookEvent,
} from "../gateway.js";

const API = "https://api.stripe.com/v1";

type Json = Record<string, unknown>;

/** Flatten nested objects/arrays into Stripe's `a[b][0][c]=v` form encoding. */
function encodeForm(params: Json, form = new URLSearchParams(), prefix = ""): URLSearchParams {
  for (const [k, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          encodeForm(item as Json, form, `${key}[${i}]`);
        } else {
          form.append(`${key}[${i}]`, String(item));
        }
      });
    } else if (typeof value === "object") {
      encodeForm(value as Json, form, key);
    } else {
      form.append(key, String(value));
    }
  }
  return form;
}

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export class StripeGateway implements BillingGateway {
  readonly name = "stripe";

  constructor(private key: string) {}

  /* ------------------------------- transport ----------------------------- */

  private async call<T = Json>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params?: Json,
  ): Promise<T> {
    if (!this.key) throw new BillingError("Stripe secret key is not configured.", "stripe");

    let url = `${API}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    };
    if (params && method === "GET") {
      url += `?${encodeForm(params).toString()}`;
    } else if (params) {
      init.body = encodeForm(params);
    }

    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const err = (data.error ?? {}) as { message?: string; type?: string };
      throw new BillingError(err.message ?? `Stripe request failed (${res.status})`, "stripe");
    }
    return data as T;
  }

  /* ------------------------------- customers ----------------------------- */

  async createCustomer(details: CustomerDetails): Promise<GatewayCustomer> {
    const c = await this.call("POST", "/customers", {
      name: details.name,
      email: details.email,
      metadata: details.metadata,
    });
    return { id: String(c.id), email: c.email as string, name: c.name as string };
  }

  async updateCustomer(id: string, details: CustomerDetails): Promise<GatewayCustomer> {
    const c = await this.call("POST", `/customers/${id}`, {
      name: details.name,
      email: details.email,
      metadata: details.metadata,
    });
    return { id: String(c.id), email: c.email as string, name: c.name as string };
  }

  /* ----------------------------- subscriptions --------------------------- */

  async createSubscription(params: CreateSubscriptionParams): Promise<GatewaySubscription> {
    const sub = await this.call("POST", "/subscriptions", {
      customer: params.customer,
      items: params.items.map((i) => ({ price: i.price, quantity: i.quantity })),
      trial_end: params.trialEnd ? unix(params.trialEnd) : undefined,
      default_payment_method: params.paymentMethod,
      metadata: params.metadata,
      expand: ["items.data.price"],
    });
    return this.normalize(sub);
  }

  async swapSubscription(id: string, params: SwapParams): Promise<GatewaySubscription> {
    const current = await this.call("GET", `/subscriptions/${id}`, {
      "expand": ["items.data.price"],
    });
    const currentItems = (((current.items as Json)?.data as Json[]) ?? []).map((i) => String(i.id));

    // Map new prices onto existing item slots; delete any leftover items.
    const items: Json[] = params.items.map((ref, i) =>
      i < currentItems.length
        ? { id: currentItems[i], price: ref.price, quantity: ref.quantity }
        : { price: ref.price, quantity: ref.quantity },
    );
    for (let i = params.items.length; i < currentItems.length; i++) {
      items.push({ id: currentItems[i], deleted: true });
    }

    const sub = await this.call("POST", `/subscriptions/${id}`, {
      items,
      proration_behavior: params.prorate === false ? "none" : "create_prorations",
      expand: ["items.data.price"],
    });
    return this.normalize(sub);
  }

  async updateQuantity(
    id: string,
    quantity: number,
    opts?: { prorate?: boolean },
  ): Promise<GatewaySubscription> {
    const current = await this.call("GET", `/subscriptions/${id}`);
    const firstItem = ((current.items as Json)?.data as Json[])?.[0];
    if (!firstItem) throw new BillingError("Subscription has no items to update.", "stripe");
    const sub = await this.call("POST", `/subscriptions/${id}`, {
      items: [{ id: String(firstItem.id), quantity }],
      proration_behavior: opts?.prorate === false ? "none" : "create_prorations",
      expand: ["items.data.price"],
    });
    return this.normalize(sub);
  }

  async cancelSubscription(id: string, params?: CancelParams): Promise<GatewaySubscription> {
    if (params?.now) {
      return this.normalize(await this.call("DELETE", `/subscriptions/${id}`));
    }
    return this.normalize(
      await this.call("POST", `/subscriptions/${id}`, {
        cancel_at_period_end: true,
        expand: ["items.data.price"],
      }),
    );
  }

  async resumeSubscription(id: string): Promise<GatewaySubscription> {
    return this.normalize(
      await this.call("POST", `/subscriptions/${id}`, {
        cancel_at_period_end: false,
        expand: ["items.data.price"],
      }),
    );
  }

  /* ------------------------------- charges ------------------------------- */

  async charge(params: ChargeParams): Promise<GatewayCharge> {
    const intent = await this.call("POST", "/payment_intents", {
      amount: params.amount,
      currency: params.currency ?? "usd",
      customer: params.customer,
      payment_method: params.paymentMethod,
      description: params.description,
      metadata: params.metadata,
      confirm: true,
      off_session: true,
    });
    return {
      id: String(intent.id),
      status: String(intent.status),
      amount: Number(intent.amount),
      currency: String(intent.currency),
    };
  }

  async refund(params: RefundParams): Promise<GatewayRefund> {
    const key = params.charge.startsWith("pi_") ? "payment_intent" : "charge";
    const refund = await this.call("POST", "/refunds", {
      [key]: params.charge,
      amount: params.amount,
    });
    return { id: String(refund.id), amount: Number(refund.amount ?? 0), status: String(refund.status) };
  }

  async listInvoices(customer: string): Promise<GatewayInvoice[]> {
    const res = await this.call("GET", "/invoices", { customer, limit: 100 });
    const data = (res.data as Json[]) ?? [];
    return data.map((inv) => ({
      id: String(inv.id),
      number: (inv.number as string) ?? null,
      total: Number(inv.total ?? 0),
      currency: String(inv.currency ?? "usd"),
      status: String(inv.status ?? ""),
      date: inv.created ? new Date(Number(inv.created) * 1000) : null,
      url: (inv.hosted_invoice_url as string) ?? null,
    }));
  }

  /* ------------------------------ checkout ------------------------------- */

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutSession> {
    const session = await this.call("POST", "/checkout/sessions", {
      mode: params.mode,
      customer: params.customer,
      line_items: params.items.map((i) => ({ price: i.price, quantity: i.quantity ?? 1 })),
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: params.allowPromotionCodes,
      metadata: params.metadata,
      subscription_data:
        params.mode === "subscription" && params.trialEnd
          ? { trial_end: unix(params.trialEnd) }
          : undefined,
    });
    return { id: String(session.id), url: (session.url as string) ?? null, raw: session };
  }

  /* ------------------- optional gateway capabilities -------------------- */

  async createSetupIntent(customer: string): Promise<SetupIntent> {
    const intent = await this.call("POST", "/setup_intents", { customer });
    return { id: String(intent.id), clientSecret: (intent.client_secret as string) ?? null };
  }

  async paymentMethods(customer: string): Promise<PaymentMethod[]> {
    const res = await this.call("GET", "/payment_methods", { customer, type: "card" });
    const data = (res.data as Json[]) ?? [];
    return data.map((pm) => {
      const card = (pm.card as Json) ?? {};
      return {
        id: String(pm.id),
        type: String(pm.type ?? "card"),
        last4: (card.last4 as string) ?? null,
        brand: (card.brand as string) ?? null,
      };
    });
  }

  /* ------------------------------ webhooks ------------------------------- */

  async verifyWebhook(
    rawBody: string,
    headers: HeaderBag,
    secret: string,
  ): Promise<WebhookEvent | null> {
    const header = headers("stripe-signature");
    if (!header || !secret) return null;

    const parts = Object.fromEntries(
      header.split(",").map((p) => {
        const [k, v] = p.split("=");
        return [k?.trim(), v?.trim()];
      }),
    ) as { t?: string; v1?: string };
    if (!parts.t || !parts.v1) return null;

    const expected = await hmacSha256Hex(secret, `${parts.t}.${rawBody}`);
    if (!constantTimeEqual(parts.v1, expected)) return null;

    const event = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data: { object: Json };
    };
    const object = event.data?.object ?? {};
    const subscription = event.type.startsWith("customer.subscription.")
      ? this.normalize(object)
      : undefined;
    return {
      id: event.id,
      type: event.type,
      payload: event as unknown as Json,
      subscription,
      customer: subscription?.customer ?? (object.customer as string | undefined),
    };
  }

  /* ------------------------------ mapping -------------------------------- */

  private normalize(sub: Json): GatewaySubscription {
    const items = (((sub.items as Json)?.data as Json[]) ?? []).map((i) => {
      const price = (i.price as Json) ?? {};
      return {
        id: String(i.id),
        product: String(price.product ?? ""),
        price: String(price.id ?? ""),
        quantity: i.quantity != null ? Number(i.quantity) : undefined,
      };
    });

    const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
    const endsAt = cancelAtPeriodEnd
      ? sub.current_period_end
        ? new Date(Number(sub.current_period_end) * 1000)
        : null
      : sub.canceled_at
        ? new Date(Number(sub.canceled_at) * 1000)
        : null;

    return {
      id: String(sub.id),
      status: String(sub.status ?? ""),
      items,
      quantity: sub.quantity != null ? Number(sub.quantity) : (items[0]?.quantity ?? null),
      trialEndsAt: sub.trial_end ? new Date(Number(sub.trial_end) * 1000) : null,
      endsAt,
      customer: sub.customer ? String(sub.customer) : undefined,
    };
  }
}
