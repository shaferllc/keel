/**
 * The `Billable` mixin — apply it to a model to give that model a gateway
 * customer, subscriptions, charges, and checkout:
 *
 *   class User extends Billable(Model) {
 *     static table = "users";
 *     declare email: string;
 *   }
 *
 *   if (user.subscribed()) { ... }
 *   await user.newSubscription("default", "price_pro").trialDays(14).create(pmId);
 *   await user.charge(2000, { paymentMethod: pmId });
 *
 * Methods are thin: they resolve the active gateway (a model has no DI, so this
 * goes through the `billing()` module singleton), call it, and persist local
 * `Subscription` state. Customer-detail hooks (`billingEmail`, `billingName`)
 * are overridable on the model.
 */

import { Model } from "../core/model.js";
import type { Row } from "../core/database.js";
import { billing } from "./manager.js";
import { Subscription } from "./subscription.js";
import { SubscriptionBuilder } from "./builder.js";
import { BillingError } from "./gateway.js";
import type {
  BillingGateway,
  GatewayCharge,
  GatewayInvoice,
  GatewayRefund,
  SetupIntent,
  PaymentMethod,
  CheckoutSession,
  CheckoutParams,
  PriceRef,
} from "./gateway.js";

// Constructor shape the mixin accepts — the `Model` class or a subclass. The
// `...args: any[]` signature is required for a TypeScript mixin base (TS2545).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelCtor = new (...args: any[]) => Model;

export interface ChargeOptions {
  currency?: string;
  paymentMethod?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface ProductCheckoutOptions {
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
  allowPromotionCodes?: boolean;
}

/**
 * The instance surface the mixin adds. Declared explicitly so the mixin's
 * generated `.d.ts` references this named type rather than trying to emit the
 * anonymous returned class — the latter fails (TS4094) because `Model` has
 * private members.
 */
export interface BillableInstance {
  billing_gateway: string | null;
  billing_customer_id: string | null;
  pm_type: string | null;
  pm_last_four: string | null;
  trial_ends_at: Date | null;

  billingName(): string | undefined;
  billingEmail(): string | undefined;
  gatewayName(): string;
  billingGateway(): BillingGateway;

  hasBillingId(): boolean;
  createAsCustomer(): Promise<string>;
  getCustomerId(): Promise<string>;
  billableId(): number | string;
  billableType(): string;

  subscriptions(): Promise<Subscription[]>;
  subscription(type?: string): Promise<Subscription | null>;
  newSubscription(
    type: string,
    prices: string | PriceRef | (string | PriceRef)[],
  ): SubscriptionBuilder;
  subscribed(type?: string): Promise<boolean>;
  subscribedToPrice(price: string, type?: string): Promise<boolean>;
  onTrial(type?: string): Promise<boolean>;
  onGenericTrial(): boolean;

  charge(amount: number, options?: ChargeOptions): Promise<GatewayCharge>;
  refund(chargeId: string, amount?: number): Promise<GatewayRefund>;
  invoices(): Promise<GatewayInvoice[]>;
  checkout(
    prices: string | PriceRef | (string | PriceRef)[],
    options?: ProductCheckoutOptions,
  ): Promise<CheckoutSession>;

  createSetupIntent(): Promise<SetupIntent>;
  paymentMethods(): Promise<PaymentMethod[]>;
}

/**
 * The class a `Billable(Base)` call returns: billing instances plus all of
 * `Base`. The widening construct signature comes first so `extends` derives the
 * instance type from it (`InstanceType<TBase> & BillableInstance`); intersecting
 * `TBase` last carries `Base`'s statics *and* its private-member brand, so
 * `this`-typed statics like `Model.create` still resolve. An explicit return
 * type is required regardless — the inferred anonymous mixin class can't be
 * emitted to a `.d.ts` because `Model` has private members (TS4094).
 */
export type BillableClass<TBase extends ModelCtor> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (new (...args: any[]) => InstanceType<TBase> & BillableInstance) & TBase;

export function Billable<TBase extends ModelCtor>(Base: TBase): BillableClass<TBase> {
  class BillableModel extends Base {
    // Columns the billing migration adds to the billable table.
    declare billing_gateway: string | null;
    declare billing_customer_id: string | null;
    declare pm_type: string | null;
    declare pm_last_four: string | null;
    declare trial_ends_at: Date | null;

    /* --------------------- overridable customer detail -------------------- */

    /** The name to sync to the gateway customer. Override as needed. */
    billingName(): string | undefined {
      return (this as Row).name as string | undefined;
    }

    /** The email to sync to the gateway customer. Override as needed. */
    billingEmail(): string | undefined {
      return (this as Row).email as string | undefined;
    }

    /* ---------------------------- gateway wiring -------------------------- */

    /** The gateway this billable uses (its own, or the configured default). */
    gatewayName(): string {
      return this.billing_gateway ?? billing().config().default;
    }

    billingGateway(): BillingGateway {
      return billing().gateway(this.gatewayName());
    }

    /* ------------------------------- customer ----------------------------- */

    hasBillingId(): boolean {
      return this.billing_customer_id != null && this.billing_customer_id !== "";
    }

    /** Create the gateway customer and store its id on this model. */
    async createAsCustomer(): Promise<string> {
      const gateway = this.billingGateway();
      const customer = await gateway.createCustomer({
        ...(this.billingName() ? { name: this.billingName()! } : {}),
        ...(this.billingEmail() ? { email: this.billingEmail()! } : {}),
      });
      this.billing_gateway = gateway.name;
      this.billing_customer_id = customer.id;
      await (this as unknown as Model).save();
      return customer.id;
    }

    /** The gateway customer id, creating the customer if it doesn't exist yet. */
    async getCustomerId(): Promise<string> {
      if (this.hasBillingId()) return this.billing_customer_id!;
      return this.createAsCustomer();
    }

    billableId(): number | string {
      return (this as Row)[(this.constructor as typeof Model).primaryKey] as number | string;
    }

    billableType(): string {
      return this.constructor.name;
    }

    /* ----------------------------- subscriptions -------------------------- */

    /** Every subscription this billable owns, newest first. */
    async subscriptions(): Promise<Subscription[]> {
      const rows = await Subscription.query()
        .where("billable_id", this.billableId())
        .where("billable_type", this.billableType())
        .orderBy("id", "desc")
        .get();
      return rows.map((r) => new Subscription(r));
    }

    /** The named subscription (default: "default"), or null. */
    async subscription(type = "default"): Promise<Subscription | null> {
      const rows = await Subscription.query()
        .where("billable_id", this.billableId())
        .where("billable_type", this.billableType())
        .where("type", type)
        .orderBy("id", "desc")
        .get();
      return rows[0] ? new Subscription(rows[0]) : null;
    }

    /** Begin building a new subscription. */
    newSubscription(type: string, prices: string | PriceRef | (string | PriceRef)[]): SubscriptionBuilder {
      return new SubscriptionBuilder(this, type, prices);
    }

    /** Is the named subscription currently valid (active/trial/grace)? */
    async subscribed(type = "default"): Promise<boolean> {
      return (await this.subscription(type))?.valid() ?? false;
    }

    /** Is the named subscription on the given price? */
    async subscribedToPrice(price: string, type = "default"): Promise<boolean> {
      const sub = await this.subscription(type);
      return !!sub && sub.valid() && sub.hasPrice(price);
    }

    /** On a trial of the named subscription? */
    async onTrial(type = "default"): Promise<boolean> {
      return (await this.subscription(type))?.onTrial() ?? false;
    }

    /** On a generic trial (a `trial_ends_at` on the billable, no subscription yet)? */
    onGenericTrial(): boolean {
      return this.trial_ends_at != null && this.trial_ends_at.getTime() > Date.now();
    }

    /* ------------------------------- charges ------------------------------ */

    /** Charge the customer a one-off amount (smallest currency unit). */
    async charge(amount: number, options: ChargeOptions = {}): Promise<GatewayCharge> {
      const customer = await this.getCustomerId();
      return this.billingGateway().charge({
        customer,
        amount,
        currency: options.currency ?? billing().config().currency,
        ...(options.paymentMethod ? { paymentMethod: options.paymentMethod } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
      });
    }

    /** Refund a prior charge (full, or a partial `amount`). */
    async refund(chargeId: string, amount?: number): Promise<GatewayRefund> {
      return this.billingGateway().refund({
        charge: chargeId,
        ...(amount != null ? { amount } : {}),
      });
    }

    /** The customer's invoices. */
    async invoices(): Promise<GatewayInvoice[]> {
      if (!this.hasBillingId()) return [];
      return this.billingGateway().listInvoices(this.billing_customer_id!);
    }

    /* ------------------------------ checkout ------------------------------ */

    /** Hosted checkout for a one-off product purchase. */
    async checkout(
      prices: string | PriceRef | (string | PriceRef)[],
      options: ProductCheckoutOptions = {},
    ): Promise<CheckoutSession> {
      const customer = await this.getCustomerId();
      const items = (Array.isArray(prices) ? prices : [prices]).map((p) =>
        typeof p === "string" ? { price: p } : p,
      );
      const params: CheckoutParams = {
        mode: "payment",
        customer,
        items,
        ...(options.successUrl ? { successUrl: options.successUrl } : {}),
        ...(options.cancelUrl ? { cancelUrl: options.cancelUrl } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(options.allowPromotionCodes != null
          ? { allowPromotionCodes: options.allowPromotionCodes }
          : {}),
      };
      return this.billingGateway().createCheckoutSession(params);
    }

    /* ------------------- optional gateway capabilities -------------------- */

    /** Create a SetupIntent to collect a payment method (Stripe). */
    async createSetupIntent(): Promise<SetupIntent> {
      const gateway = this.billingGateway();
      if (!gateway.createSetupIntent) {
        throw new BillingError(
          `The "${gateway.name}" gateway does not support setup intents.`,
          gateway.name,
        );
      }
      return gateway.createSetupIntent(await this.getCustomerId());
    }

    /** The customer's stored payment methods (Stripe). */
    async paymentMethods(): Promise<PaymentMethod[]> {
      const gateway = this.billingGateway();
      if (!gateway.paymentMethods) {
        throw new BillingError(
          `The "${gateway.name}" gateway does not expose payment methods.`,
          gateway.name,
        );
      }
      if (!this.hasBillingId()) return [];
      return gateway.paymentMethods(this.billing_customer_id!);
    }
  }

  return BillableModel as unknown as BillableClass<TBase>;
}
