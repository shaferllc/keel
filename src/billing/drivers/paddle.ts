/**
 * The Paddle (Billing) gateway. Paddle is a merchant-of-record with a
 * client-driven checkout, so its model differs from Stripe in two honest ways:
 * new subscriptions are born from a completed checkout/transaction (not created
 * server-side), and one-off charges go through transactions. Those methods throw
 * a clear `BillingError` pointing at `checkout()`; everything else maps onto the
 * Paddle REST API with JSON + Bearer auth.
 *
 * Webhook signatures use Paddle's `ts;h1` scheme: HMAC-SHA256 hex of
 * `${ts}:${rawBody}` under the notification secret.
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
  HeaderBag,
  WebhookEvent,
} from "../gateway.js";

type Json = Record<string, unknown>;

export interface PaddleOptions {
  sandbox?: boolean;
  clientToken?: string;
}

export class PaddleGateway implements BillingGateway {
  readonly name = "paddle";
  private base: string;

  constructor(
    private key: string,
    private options: PaddleOptions = {},
  ) {
    this.base = options.sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  }

  /* ------------------------------- transport ----------------------------- */

  private async call<T = Json>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: Json,
  ): Promise<T> {
    if (!this.key) throw new BillingError("Paddle API key is not configured.", "paddle");
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as { data?: unknown; error?: Json };
    if (!res.ok) {
      const err = (data.error ?? {}) as { detail?: string; code?: string };
      throw new BillingError(err.detail ?? `Paddle request failed (${res.status})`, "paddle");
    }
    return (data.data ?? data) as T;
  }

  /* ------------------------------- customers ----------------------------- */

  async createCustomer(details: CustomerDetails): Promise<GatewayCustomer> {
    const c = await this.call("POST", "/customers", {
      email: details.email,
      name: details.name,
    });
    return { id: String(c.id), email: c.email as string, name: c.name as string };
  }

  async updateCustomer(id: string, details: CustomerDetails): Promise<GatewayCustomer> {
    const c = await this.call("PATCH", `/customers/${id}`, {
      email: details.email,
      name: details.name,
    });
    return { id: String(c.id), email: c.email as string, name: c.name as string };
  }

  /* ----------------------------- subscriptions --------------------------- */

  createSubscription(_params: CreateSubscriptionParams): Promise<GatewaySubscription> {
    throw new BillingError(
      "Paddle subscriptions are created from a completed checkout. Use newSubscription(...).checkout() and let the webhook create the local record.",
      "paddle",
    );
  }

  async swapSubscription(id: string, params: SwapParams): Promise<GatewaySubscription> {
    const sub = await this.call("PATCH", `/subscriptions/${id}`, {
      items: params.items.map((i) => ({ price_id: i.price, quantity: i.quantity ?? 1 })),
      proration_billing_mode:
        params.prorate === false ? "do_not_bill" : "prorated_immediately",
    });
    return this.normalize(sub);
  }

  async updateQuantity(
    id: string,
    quantity: number,
    opts?: { prorate?: boolean },
  ): Promise<GatewaySubscription> {
    const current = await this.call<Json>("GET", `/subscriptions/${id}`);
    const items = ((current.items as Json[]) ?? []).map((it, i) => ({
      price_id: String((it.price as Json)?.id ?? ""),
      quantity: i === 0 ? quantity : Number(it.quantity ?? 1),
    }));
    const sub = await this.call("PATCH", `/subscriptions/${id}`, {
      items,
      proration_billing_mode: opts?.prorate === false ? "do_not_bill" : "prorated_immediately",
    });
    return this.normalize(sub);
  }

  async cancelSubscription(id: string, params?: CancelParams): Promise<GatewaySubscription> {
    const sub = await this.call("POST", `/subscriptions/${id}/cancel`, {
      effective_from: params?.now ? "immediately" : "next_billing_period",
    });
    return this.normalize(sub);
  }

  async resumeSubscription(id: string): Promise<GatewaySubscription> {
    // Removing the scheduled cancellation resumes the subscription.
    const sub = await this.call("PATCH", `/subscriptions/${id}`, { scheduled_change: null });
    return this.normalize(sub);
  }

  /* ------------------------------- charges ------------------------------- */

  charge(_params: ChargeParams): Promise<GatewayCharge> {
    throw new BillingError(
      "Paddle one-off charges are collected via a transaction/checkout. Use checkout() with mode 'payment'.",
      "paddle",
    );
  }

  async refund(params: RefundParams): Promise<GatewayRefund> {
    const adj = await this.call("POST", "/adjustments", {
      action: "refund",
      transaction_id: params.charge,
      reason: "requested_by_customer",
      type: params.amount != null ? "partial" : "full",
    });
    return {
      id: String(adj.id),
      amount: Number((adj.totals as Json)?.total ?? params.amount ?? 0),
      status: String(adj.status ?? "pending"),
    };
  }

  async listInvoices(customer: string): Promise<GatewayInvoice[]> {
    const res = await this.call<Json[]>("GET", `/transactions?customer_id=${customer}&per_page=100`);
    const data = Array.isArray(res) ? res : [];
    return data.map((tx) => {
      const totals = (tx.details as Json)?.totals as Json | undefined;
      return {
        id: String(tx.id),
        number: (tx.invoice_number as string) ?? null,
        total: Number(totals?.grand_total ?? 0),
        currency: String(tx.currency_code ?? "usd").toLowerCase(),
        status: String(tx.status ?? ""),
        date: tx.created_at ? new Date(String(tx.created_at)) : null,
        url: null,
      };
    });
  }

  /* ------------------------------ checkout ------------------------------- */

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutSession> {
    // A transaction is Paddle's server-side checkout handle; the overlay/inline
    // widget completes it client-side with the client token.
    const tx = await this.call("POST", "/transactions", {
      items: params.items.map((i) => ({ price_id: i.price, quantity: i.quantity ?? 1 })),
      customer_id: params.customer,
      collection_mode: "automatic",
      custom_data: params.metadata,
    });
    const checkout = (tx.checkout as Json) ?? {};
    return {
      id: String(tx.id),
      url: (checkout.url as string) ?? null,
      clientToken: this.options.clientToken ?? null,
      raw: tx,
    };
  }

  /* ------------------------------ webhooks ------------------------------- */

  async verifyWebhook(
    rawBody: string,
    headers: HeaderBag,
    secret: string,
  ): Promise<WebhookEvent | null> {
    const header = headers("paddle-signature");
    if (!header || !secret) return null;

    const parts = Object.fromEntries(
      header.split(";").map((p) => {
        const [k, v] = p.split("=");
        return [k?.trim(), v?.trim()];
      }),
    ) as { ts?: string; h1?: string };
    if (!parts.ts || !parts.h1) return null;

    const expected = await hmacSha256Hex(secret, `${parts.ts}:${rawBody}`);
    if (!constantTimeEqual(parts.h1, expected)) return null;

    const event = JSON.parse(rawBody) as {
      event_id?: string;
      event_type: string;
      data: Json;
    };
    const subscription = event.event_type.startsWith("subscription.")
      ? this.normalize(event.data)
      : undefined;
    return {
      id: event.event_id ?? "",
      type: event.event_type,
      payload: event as unknown as Json,
      subscription,
      customer: subscription?.customer ?? (event.data.customer_id as string | undefined),
    };
  }

  /* ------------------------------ mapping -------------------------------- */

  private normalize(sub: Json): GatewaySubscription {
    const items = ((sub.items as Json[]) ?? []).map((it) => {
      const price = (it.price as Json) ?? {};
      return {
        id: String(price.id ?? ""),
        product: String(price.product_id ?? ""),
        price: String(price.id ?? ""),
        quantity: it.quantity != null ? Number(it.quantity) : undefined,
      };
    });

    const scheduled = (sub.scheduled_change as Json) ?? null;
    const endsAt =
      scheduled && scheduled.action === "cancel" && scheduled.effective_at
        ? new Date(String(scheduled.effective_at))
        : sub.canceled_at
          ? new Date(String(sub.canceled_at))
          : null;

    const trialEnd = (sub.items as Json[] | undefined)?.[0]?.trial_dates as Json | undefined;

    return {
      id: String(sub.id),
      status: String(sub.status ?? ""),
      items,
      quantity: items[0]?.quantity ?? null,
      trialEndsAt: trialEnd?.ends_at ? new Date(String(trialEnd.ends_at)) : null,
      endsAt,
      customer: sub.customer_id ? String(sub.customer_id) : undefined,
    };
  }
}
