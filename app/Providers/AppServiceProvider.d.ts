import { ServiceProvider } from "@keel/core";
/**
 * The primary application provider. Bind your services in register(),
 * wire them together in boot().
 */
export declare class AppServiceProvider extends ServiceProvider {
    register(): void;
    boot(): Promise<void>;
}
