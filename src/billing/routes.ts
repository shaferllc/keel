/**
 * The billing HTTP surface: one webhook endpoint per gateway. The raw request
 * body is read with `c.req.text()` (never `c.req.json()` first — the body stream
 * is single-use and signature verification needs the exact bytes), and the
 * `:gateway` segment selects which driver verifies it.
 *
 * Mounted by the provider at the configured `webhook.path` — e.g.
 * `POST /billing/webhook/stripe`.
 */

import type { Router, Ctx } from "../core/http/router.js";
import { handleWebhook } from "./webhooks.js";

export function registerBillingRoutes(r: Router, webhookPath: string): void {
  const base = "/" + webhookPath.replace(/^\/|\/$/g, "");

  r.post(`${base}/:gateway`, async (c: Ctx) => {
    const gateway = c.req.param("gateway") ?? "";
    const rawBody = await c.req.text();
    const result = await handleWebhook(gateway, rawBody, (name) => c.req.header(name));
    if (!result.ok) return c.json({ received: false }, 400);
    return c.json({ received: true });
  }).name("webhook");
}
