/**
 * The fluent subscription builder — Cashier's `newSubscription(...)->create()`.
 * The `Billable` mixin hands it a small `BillableTarget` (so this file needn't
 * import the mixin, avoiding a cycle); the builder shapes the request, calls the
 * gateway, and persists a local `Subscription` synced from the result.
 *
 *   await user.newSubscription("default", "price_pro")
 *     .trialDays(14)
 *     .quantity(3)
 *     .create(paymentMethodId);
 */

import { billing } from "./manager.js";
import { Subscription, toRefs, type PriceArg } from "./subscription.js";
import type { CheckoutSession, PriceRef } from "./gateway.js";

const DAY = 86_400_000;

/** What the builder needs from the billable that started it. */
export interface BillableTarget {
  /** Ensure a gateway customer exists and return its id. */
  getCustomerId(): Promise<string>;
  gatewayName(): string;
  billableId(): number | string;
  billableType(): string;
}

export interface CheckoutOptions {
  successUrl?: string;
  cancelUrl?: string;
  allowPromotionCodes?: boolean;
  metadata?: Record<string, string>;
}

export class SubscriptionBuilder {
  private refs: PriceRef[];
  private _trialEnd?: Date;
  private _skipTrial = false;
  private _quantity?: number;
  private _metadata?: Record<string, string>;

  constructor(
    private owner: BillableTarget,
    private type: string,
    prices: PriceArg | PriceArg[],
  ) {
    this.refs = toRefs(prices);
  }

  /** Trial for N days from now. */
  trialDays(days: number): this {
    this._trialEnd = new Date(Date.now() + days * DAY);
    return this;
  }

  /** Trial until a specific moment. */
  trialUntil(date: Date): this {
    this._trialEnd = date;
    return this;
  }

  /** Start without any trial. */
  skipTrial(): this {
    this._skipTrial = true;
    return this;
  }

  /** Quantity for a single-price subscription. */
  quantity(quantity: number): this {
    this._quantity = quantity;
    return this;
  }

  withMetadata(metadata: Record<string, string>): this {
    this._metadata = metadata;
    return this;
  }

  /** Create the subscription, billing `paymentMethod` (or the default on file). */
  async create(paymentMethod?: string): Promise<Subscription> {
    const customer = await this.owner.getCustomerId();
    const gateway = billing().gateway(this.owner.gatewayName());
    const remote = await gateway.createSubscription({
      customer,
      items: this.items(),
      ...(this.trialEnd() ? { trialEnd: this.trialEnd()! } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(this._metadata ? { metadata: this._metadata } : {}),
    });

    const subscription = await Subscription.create({
      billable_id: this.owner.billableId(),
      billable_type: this.owner.billableType(),
      type: this.type,
      gateway: this.owner.gatewayName(),
      provider_id: remote.id,
      provider_status: remote.status,
      starts_at: new Date(),
    });
    await subscription.syncFromGateway(remote);
    return subscription;
  }

  /** Add a subscription for a customer who already has a payment method. */
  add(): Promise<Subscription> {
    return this.create();
  }

  /** Start a hosted checkout for this subscription instead of creating it now. */
  async checkout(options: CheckoutOptions = {}): Promise<CheckoutSession> {
    const customer = await this.owner.getCustomerId();
    const gateway = billing().gateway(this.owner.gatewayName());
    return gateway.createCheckoutSession({
      mode: "subscription",
      customer,
      items: this.items(),
      ...(this.trialEnd() ? { trialEnd: this.trialEnd()! } : {}),
      ...(options.successUrl ? { successUrl: options.successUrl } : {}),
      ...(options.cancelUrl ? { cancelUrl: options.cancelUrl } : {}),
      ...(options.allowPromotionCodes != null
        ? { allowPromotionCodes: options.allowPromotionCodes }
        : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    });
  }

  private items(): PriceRef[] {
    if (this._quantity == null) return this.refs;
    return this.refs.map((r, i) => (i === 0 ? { ...r, quantity: this._quantity } : r));
  }

  private trialEnd(): Date | undefined {
    return this._skipTrial ? undefined : this._trialEnd;
  }
}
