/**
 * Billing events. Augmenting Keel's `EventsList` makes these payloads typed
 * wherever `emit`/`listen` are used — `listen("billing.subscription.updated",
 * (e) => …)` gets a checked `e`. Apps subscribe to drive their own side effects
 * (grant access, send a receipt) off a verified webhook.
 */

export interface SubscriptionEvent {
  gateway: string;
  subscriptionId: number | string;
  providerId: string;
  status: string;
}

export interface WebhookReceivedEvent {
  gateway: string;
  type: string;
  id: string;
}

declare module "../core/events.js" {
  interface EventsList {
    "billing.webhook.received": WebhookReceivedEvent;
    "billing.subscription.created": SubscriptionEvent;
    "billing.subscription.updated": SubscriptionEvent;
    "billing.subscription.deleted": SubscriptionEvent;
  }
}
