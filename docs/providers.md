# Service Providers

Service providers are the central place to configure your application. Nearly
everything Keel boots — config, routing, your own services — is wired up in a
provider.

## The lifecycle

A provider has two methods, run in two distinct phases:

```ts
import { ServiceProvider } from "@keel/core";

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Phase 1. Bind things into the container.
    // Do NOT resolve other services here — nothing is guaranteed
    // to be registered yet.
  }

  boot(): void {
    // Phase 2. Runs after EVERY provider has registered.
    // Safe to resolve services and wire them together.
  }
}
```

The `Application` runs **all** `register()` methods first, then **all** `boot()`
methods. That ordering is what lets providers depend on each other without
worrying about load order.

Both methods may be `async` — the application awaits them.

## Registering a provider

Add your provider class to `bootstrap/providers.ts`:

```ts
import type { ProviderClass } from "@keel/core";
import { AppServiceProvider } from "../app/Providers/AppServiceProvider.js";
import { BillingServiceProvider } from "../app/Providers/BillingServiceProvider.js";

export const providers: ProviderClass[] = [
  AppServiceProvider,
  BillingServiceProvider,
];
```

Providers boot in array order.

## Generating a provider

```bash
npm run keel make:provider Billing
```

Writes `app/Providers/BillingServiceProvider.ts`. Remember to add it to
`bootstrap/providers.ts`.

## A realistic example

```ts
import { ServiceProvider, Config } from "@keel/core";
import { StripeClient } from "../Services/StripeClient.js";

export class BillingServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(StripeClient, (app) => {
      const key = app.make(Config).get<string>("services.stripe.key");
      return new StripeClient(key);
    });
  }

  boot(): void {
    // e.g. register webhooks, warm a cache, etc.
  }
}
```

Now any controller or service can `this.app.make(StripeClient)` and get the same
configured instance.

## Rules of thumb

- **`register()` binds. `boot()` uses.** Resolving a service in `register()` is
  the most common mistake — the thing you need may not be bound yet.
- **Keep providers focused.** One provider per concern (billing, auth, search)
  reads better than one giant `AppServiceProvider`.
- **Order matters only for `boot()` side effects**, since all registration
  happens before any booting.
