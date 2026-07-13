/**
 * Billing configuration. Defaults live here and are merged under
 * `config("billing")` by the provider; an app overrides any of them in
 * `config/billing.ts` (publish it with `keel vendor:publish --tag billing-config`).
 *
 * The shape mirrors Keel's other multi-driver managers (mail, queue, database):
 * a `default` gateway plus a `gateways` map the drivers read their keys from.
 */

import { config } from "../core/helpers.js";

export interface StripeGatewayConfig {
  key: string;
  webhookSecret: string;
  publishableKey?: string;
  /** Drivers read only what they know; extra keys are allowed. */
  [k: string]: unknown;
}

export interface PaddleGatewayConfig {
  key: string;
  webhookSecret: string;
  clientToken?: string;
  sandbox?: boolean;
  [k: string]: unknown;
}

export interface BillingConfig {
  /** Which gateway is active: "stripe" | "paddle" | "fake". */
  default: string;
  /** Default currency for one-off charges, ISO 4217 lowercase. */
  currency: string;
  /** The class name stored in `subscriptions.billable_type`. */
  billableModel: string;
  /**
   * Table the billable columns (customer id, etc.) are added to.
   * Defaults to `users`; saas kits that charge teams set this to `teams`.
   */
  billableTable: string;
  /** Base URL path the webhook routes mount under; the gateway name is appended. */
  webhook: { path: string };
  gateways: {
    stripe: StripeGatewayConfig;
    paddle: PaddleGatewayConfig;
    /** Custom gateways may add their own loosely-typed config. */
    [name: string]: Record<string, unknown>;
  };
}

export const defaultConfig: BillingConfig = {
  default: "stripe",
  currency: "usd",
  billableModel: "User",
  billableTable: "users",
  webhook: { path: "billing/webhook" },
  gateways: {
    stripe: { key: "", webhookSecret: "" },
    paddle: { key: "", webhookSecret: "", sandbox: false },
  },
};

/** Read the effective billing config off the application, filling any gaps. */
export function resolveConfig(): BillingConfig {
  const raw = config<Partial<BillingConfig>>("billing", {});
  const gateways = (raw.gateways ?? {}) as Partial<BillingConfig["gateways"]>;
  return {
    ...defaultConfig,
    ...raw,
    webhook: { ...defaultConfig.webhook, ...(raw.webhook ?? {}) },
    gateways: {
      ...defaultConfig.gateways,
      ...gateways,
      stripe: { ...defaultConfig.gateways.stripe, ...(gateways.stripe ?? {}) },
      paddle: { ...defaultConfig.gateways.paddle, ...(gateways.paddle ?? {}) },
    },
  };
}
