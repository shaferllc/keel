/**
 * Registers the built-in gateways on a manager. Kept out of `manager.ts` so the
 * manager module carries no provider SDK; the provider (and tests) call this to
 * wire Stripe, Paddle, and the Fake gateway from config.
 */

import type { BillingManager } from "../manager.js";
import type { StripeGatewayConfig, PaddleGatewayConfig } from "../config.js";
import { StripeGateway } from "./stripe.js";
import { PaddleGateway } from "./paddle.js";
import { FakeGateway } from "./fake.js";

export { StripeGateway } from "./stripe.js";
export { PaddleGateway } from "./paddle.js";
export { FakeGateway } from "./fake.js";
export type { FakeCall } from "./fake.js";

export function registerDefaultGateways(manager: BillingManager): void {
  manager.register("stripe", (cfg) => new StripeGateway((cfg as StripeGatewayConfig).key ?? ""));
  manager.register("paddle", (cfg) => {
    const c = cfg as PaddleGatewayConfig;
    return new PaddleGateway(c.key ?? "", {
      ...(c.sandbox != null ? { sandbox: c.sandbox } : {}),
      ...(c.clientToken ? { clientToken: c.clientToken } : {}),
    });
  });
  manager.register("fake", () => new FakeGateway());
}
