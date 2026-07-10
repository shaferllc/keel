import { ServiceProvider, bind } from "@keel/core";

/**
 * The primary application provider. Bind your services in register(),
 * wire them together in boot().
 */
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Global helpers — no `this.app` needed.
    bind("clock", () => new Date().toISOString());
  }

  boot(): void {
    // Runs after all providers have registered.
  }
}
