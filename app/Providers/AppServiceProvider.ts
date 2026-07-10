import { ServiceProvider } from "@keel/core";

/**
 * The primary application provider. Bind your services in register(),
 * wire them together in boot().
 */
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Example:
    // this.app.singleton("clock", () => new Date());
  }

  boot(): void {
    // Runs after all providers have registered.
  }
}
