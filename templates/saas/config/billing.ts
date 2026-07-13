import { env } from "@shaferllc/keel/core";

/**
 * Billing — the team is the customer. Stripe when keys are set; FakeGateway
 * otherwise so `npm run dev` works without a Stripe account.
 */
export default {
  default: env("BILLING_GATEWAY", "") || (env("STRIPE_SECRET_KEY", "") ? "stripe" : "fake"),

  currency: env("BILLING_CURRENCY", "usd"),

  billableModel: "Team",
  billableTable: "teams",

  /** Price id used by the starter pricing page (Stripe Price or FakeGateway id). */
  plans: {
    pro: env("STRIPE_PRICE_PRO", "price_pro"),
  },

  webhook: { path: "billing/webhook" },

  gateways: {
    stripe: {
      key: env("STRIPE_SECRET_KEY", ""),
      webhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
      publishableKey: env("STRIPE_PUBLISHABLE_KEY", ""),
    },
    paddle: {
      key: env("PADDLE_API_KEY", ""),
      webhookSecret: env("PADDLE_WEBHOOK_SECRET", ""),
      clientToken: env("PADDLE_CLIENT_TOKEN", ""),
      sandbox: env("PADDLE_SANDBOX", false),
    },
    fake: {},
  },
};
