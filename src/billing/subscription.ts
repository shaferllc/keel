/**
 * A subscription — the local mirror of a gateway subscription, and the object
 * you act on. Status questions (`active`, `onTrial`, `onGracePeriod`, …) are
 * answered from local columns; mutations (`swap`, `updateQuantity`, `cancel`,
 * `resume`) call the active gateway and then sync the result back.
 *
 *   if (subscription.onGracePeriod()) await subscription.resume();
 *   await subscription.swap("price_pro");
 *   await subscription.incrementQuantity(2);
 */

import { Model } from "../core/model.js";
import type { Casts } from "../core/casts.js";
import { billing } from "./manager.js";
import { SubscriptionItem } from "./subscription-item.js";
import type { BillingGateway, GatewaySubscription, PriceRef } from "./gateway.js";

/** Provider statuses we treat as "the subscription is live". */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
/** Provider statuses that need the customer to finish a payment. */
const INCOMPLETE_STATUSES = new Set(["incomplete", "past_due", "unpaid"]);

/** A price argument: a bare id, or `{ price, quantity }`. */
export type PriceArg = string | PriceRef;

export function toRefs(prices: PriceArg | PriceArg[]): PriceRef[] {
  const list = Array.isArray(prices) ? prices : [prices];
  return list.map((p) => (typeof p === "string" ? { price: p } : p));
}

export class Subscription extends Model {
  static table = "subscriptions";
  static timestamps = true;
  static casts: Casts = {
    provider_price: "json",
    quantity: "int",
    trial_ends_at: "date",
    starts_at: "date",
    ends_at: "date",
    paused_at: "date",
  };

  declare id: number;
  declare billable_id: number;
  declare billable_type: string;
  declare type: string;
  declare gateway: string;
  declare provider_id: string;
  declare provider_status: string;
  declare provider_price: string[] | null;
  declare quantity: number | null;
  declare trial_ends_at: Date | null;
  declare starts_at: Date | null;
  declare ends_at: Date | null;
  declare paused_at: Date | null;

  /** The subscription's line items. */
  items() {
    return this.hasMany(SubscriptionItem);
  }

  /* ------------------------------- status ------------------------------- */

  /** On an unexpired trial. */
  onTrial(): boolean {
    return this.trial_ends_at != null && this.trial_ends_at.getTime() > Date.now();
  }

  hasExpiredTrial(): boolean {
    return this.trial_ends_at != null && this.trial_ends_at.getTime() <= Date.now();
  }

  /** Cancellation has been initiated (whether or not the grace period is over). */
  canceled(): boolean {
    return this.ends_at != null;
  }

  /** Canceled, but the paid period hasn't elapsed yet — still usable. */
  onGracePeriod(): boolean {
    return this.ends_at != null && this.ends_at.getTime() > Date.now();
  }

  /** Cancellation is complete and the period has elapsed. */
  ended(): boolean {
    return this.canceled() && !this.onGracePeriod();
  }

  paused(): boolean {
    return this.provider_status === "paused" || this.paused_at != null;
  }

  /** The gateway reports a valid, live status and it hasn't ended. */
  active(): boolean {
    return ACTIVE_STATUSES.has(this.provider_status) && !this.ended() && !this.paused();
  }

  /** Active and past any trial. */
  recurring(): boolean {
    return this.active() && !this.onTrial();
  }

  /** Usable right now: active, on trial, or within the grace period. */
  valid(): boolean {
    return this.active() || this.onTrial() || this.onGracePeriod();
  }

  hasIncompletePayment(): boolean {
    return INCOMPLETE_STATUSES.has(this.provider_status);
  }

  /** Whether this subscription includes the given price. */
  hasPrice(price: string): boolean {
    return (this.provider_price ?? []).includes(price);
  }

  /* ------------------------------- actions ------------------------------ */

  /** Swap to a new price (or set of prices). */
  async swap(prices: PriceArg | PriceArg[], opts?: { prorate?: boolean }): Promise<this> {
    const result = await this.gw().swapSubscription(this.provider_id, {
      items: toRefs(prices),
      ...(opts?.prorate != null ? { prorate: opts.prorate } : {}),
    });
    return this.syncFromGateway(result);
  }

  async incrementQuantity(count = 1): Promise<this> {
    return this.updateQuantity((this.quantity ?? 1) + count);
  }

  async decrementQuantity(count = 1): Promise<this> {
    return this.updateQuantity(Math.max(0, (this.quantity ?? 1) - count));
  }

  async updateQuantity(quantity: number, opts?: { prorate?: boolean }): Promise<this> {
    const result = await this.gw().updateQuantity(this.provider_id, quantity, opts);
    return this.syncFromGateway(result);
  }

  /** Cancel at period end — keeps access through the grace period. */
  async cancel(): Promise<this> {
    return this.syncFromGateway(await this.gw().cancelSubscription(this.provider_id));
  }

  /** Cancel immediately. */
  async cancelNow(): Promise<this> {
    return this.syncFromGateway(
      await this.gw().cancelSubscription(this.provider_id, { now: true }),
    );
  }

  /** Resume a subscription still within its grace period. */
  async resume(): Promise<this> {
    return this.syncFromGateway(await this.gw().resumeSubscription(this.provider_id));
  }

  /** End the trial immediately (local state; the next invoice bills right away). */
  async endTrial(): Promise<this> {
    this.trial_ends_at = null;
    if (this.provider_status === "trialing") this.provider_status = "active";
    return this.save();
  }

  /** Extend (or set) the trial end. */
  async extendTrial(until: Date): Promise<this> {
    this.trial_ends_at = until;
    return this.save();
  }

  /* ------------------------------ internals ----------------------------- */

  /** The gateway this subscription lives on. */
  private gw(): BillingGateway {
    return billing().gateway(this.gateway);
  }

  /**
   * Fold a gateway subscription back into local columns + items, then persist.
   * The single source of truth for status flows through here (also used by the
   * webhook handler).
   */
  async syncFromGateway(remote: GatewaySubscription): Promise<this> {
    this.provider_status = remote.status;
    this.provider_price = remote.items.map((i) => i.price);
    this.quantity = remote.quantity ?? remote.items[0]?.quantity ?? this.quantity ?? null;
    this.trial_ends_at = remote.trialEndsAt ?? null;
    this.ends_at = remote.endsAt ?? null;
    await this.save();
    await this.syncItems(remote);
    return this;
  }

  /** Replace this subscription's items with the gateway's current set. */
  private async syncItems(remote: GatewaySubscription): Promise<void> {
    if (this.id == null) return;
    await SubscriptionItem.query().where("subscription_id", this.id).delete();
    for (const item of remote.items) {
      await SubscriptionItem.create({
        subscription_id: this.id,
        provider_id: item.id,
        provider_product: item.product,
        provider_price: item.price,
        quantity: item.quantity ?? 1,
      });
    }
  }
}
