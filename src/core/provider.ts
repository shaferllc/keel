/**
 * Service providers are the central place to configure the application.
 *
 * register(): bind things into the container. Do NOT resolve other services
 *             here — nothing is guaranteed to be registered yet.
 * boot():     called after every provider has registered. Safe to resolve
 *             and wire things together here.
 */

import type { Application } from "./application.js";

export abstract class ServiceProvider {
  constructor(protected app: Application) {}

  register(): void | Promise<void> {}

  boot(): void | Promise<void> {}
}

export type ProviderClass = new (app: Application) => ServiceProvider;
