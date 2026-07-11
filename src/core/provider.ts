/**
 * Service providers are the central place to configure the application — Keel's
 * plugin system. A provider packages a slice of functionality and wires it in.
 *
 * register(): bind things into the container. Do NOT resolve other services
 *             here — nothing is guaranteed to be registered yet.
 * boot():     called after every provider has registered. Safe to resolve
 *             and wire things together here.
 *
 * Register with options to make a provider reusable:
 *
 *   class RateLimitProvider extends ServiceProvider<{ max: number }> {
 *     boot() { this.app.make(HttpKernel).use(rateLimiter({ max: this.options.max })); }
 *   }
 *   app.register(RateLimitProvider, { max: 100 });
 */

import type { Application } from "./application.js";

export abstract class ServiceProvider<O = Record<string, unknown>> {
  constructor(
    protected app: Application,
    protected options: O = {} as O,
  ) {}

  register(): void | Promise<void> {}

  boot(): void | Promise<void> {}
}

// `any` on the options param keeps this construct signature compatible with
// provider subclasses that type their own options.
export type ProviderClass = new (app: Application, options?: any) => ServiceProvider;
