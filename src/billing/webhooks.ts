/**
 * The webhook handler. It verifies the raw body against the gateway's signing
 * secret, emits `billing.webhook.received`, and — when the event concerns a
 * subscription — folds the gateway's state into the local `Subscription` row and
 * emits the matching `billing.subscription.*` event.
 *
 * A known subscription (already in the DB) is always synced. An unknown one
 * (e.g. Paddle's create-on-checkout) is created only if the app registered a
 * billable resolver with `resolveBillableUsing()` — otherwise it's left to the
 * app's own `listen("billing.webhook.received", …)`.
 */

import { emit } from "../core/helpers.js";
import type { Row } from "../core/database.js";
import { billing } from "./manager.js";
import { Subscription } from "./subscription.js";
import type { HeaderBag, WebhookEvent } from "./gateway.js";
import "./events.js";

export interface WebhookResult {
  ok: boolean;
  status: 200 | 400;
  event?: WebhookEvent;
}

/** Maps a gateway customer id to a local billable, so unknown subs can be created. */
export type BillableResolver = (
  customerId: string,
  gateway: string,
) => Promise<{ id: number | string; type: string } | null>;

let resolver: BillableResolver | undefined;

/** Register how to find the billable for a gateway customer (optional). */
export function resolveBillableUsing(fn: BillableResolver | undefined): void {
  resolver = fn;
}

export async function handleWebhook(
  gatewayName: string,
  rawBody: string,
  headers: HeaderBag,
): Promise<WebhookResult> {
  const manager = billing();
  const gateway = manager.gateway(gatewayName);
  const secret = manager.webhookSecret(gatewayName);

  const event = await gateway.verifyWebhook(rawBody, headers, secret);
  if (!event) return { ok: false, status: 400 };

  await emit("billing.webhook.received", {
    gateway: gatewayName,
    type: event.type,
    id: event.id,
  });

  if (event.subscription) await syncSubscription(gatewayName, event);

  return { ok: true, status: 200, event };
}

async function syncSubscription(gatewayName: string, event: WebhookEvent): Promise<void> {
  const remote = event.subscription!;
  const existing = (await Subscription.query()
    .where("provider_id", remote.id)
    .first()) as Row | null | undefined;

  if (existing) {
    const subscription = new Subscription(existing);
    await subscription.syncFromGateway(remote);
    const deleted = event.type.includes("deleted") || subscription.ended();
    await emit(deleted ? "billing.subscription.deleted" : "billing.subscription.updated", {
      gateway: gatewayName,
      subscriptionId: subscription.id,
      providerId: subscription.provider_id,
      status: subscription.provider_status,
    });
    return;
  }

  if (!resolver || !event.customer) return;
  const target = await resolver(event.customer, gatewayName);
  if (!target) return;

  const subscription = await Subscription.create({
    billable_id: target.id,
    billable_type: target.type,
    type: "default",
    gateway: gatewayName,
    provider_id: remote.id,
    provider_status: remote.status,
    starts_at: new Date(),
  });
  await subscription.syncFromGateway(remote);
  await emit("billing.subscription.created", {
    gateway: gatewayName,
    subscriptionId: subscription.id,
    providerId: subscription.provider_id,
    status: subscription.provider_status,
  });
}
