/**
 * The billing manager — a small driver registry, exactly like Keel's mail and
 * queue managers. It holds the configured `default` gateway and lazily builds
 * each driver from a registered factory. Drivers register themselves via
 * `registerDefaultGateways` (see `drivers/index.ts`) so this module stays free
 * of any provider SDK.
 *
 * A model instance has no DI container, so — following the framework's
 * `setConnection`/`setLogger`/`setScheduler` pattern — the active manager also
 * lives in a module-level singleton. The `Billable` mixin and `Subscription`
 * model reach it with `billing()`.
 */

import type { BillingConfig } from "./config.js";
import { BillingError, type BillingGateway } from "./gateway.js";

/** Builds a gateway from its slice of config. */
export type GatewayFactory = (
  gatewayConfig: Record<string, unknown>,
  billing: BillingConfig,
) => BillingGateway;

export class BillingManager {
  private factories = new Map<string, GatewayFactory>();
  private resolved = new Map<string, BillingGateway>();

  constructor(private cfg: BillingConfig) {}

  /** Register (or replace) a gateway factory under `name`. */
  register(name: string, factory: GatewayFactory): this {
    this.factories.set(name, factory);
    this.resolved.delete(name);
    return this;
  }

  /** The effective billing config. */
  config(): BillingConfig {
    return this.cfg;
  }

  /** The webhook signing secret for a gateway (empty string if unset). */
  webhookSecret(name = this.cfg.default): string {
    const gw = this.cfg.gateways[name] as { webhookSecret?: string } | undefined;
    return gw?.webhookSecret ?? "";
  }

  /** Resolve a gateway driver, building and caching it on first use. */
  gateway(name = this.cfg.default): BillingGateway {
    const cached = this.resolved.get(name);
    if (cached) return cached;

    const factory = this.factories.get(name);
    if (!factory) {
      throw new BillingError(
        `No billing gateway registered for "${name}". Registered: ${[...this.factories.keys()].join(", ") || "none"}.`,
        name,
      );
    }
    const gateway = factory(this.cfg.gateways[name] ?? {}, this.cfg);
    this.resolved.set(name, gateway);
    return gateway;
  }
}

let current: BillingManager | undefined;

/** Install the active billing manager (called by the provider's `register`). */
export function setBilling(manager: BillingManager | undefined): void {
  current = manager;
}

/** The active billing manager. Throws if the billing provider isn't registered. */
export function billing(): BillingManager {
  if (!current) {
    throw new BillingError(
      "Billing is not configured. Register BillingServiceProvider (or call setBilling()) first.",
    );
  }
  return current;
}
