// Type-check harness for docs/providers.md. Every type-checkable snippet in the
// guide is exercised here against the real exports, so a renamed method or wrong
// signature fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  ServiceProvider,
  Config,
  Application,
  type ProviderClass,
} from "@shaferllc/keel/core";

// Stand-in services the snippets bind — shape-only, never run.
class StripeClient {
  constructor(_key: string) {}
}
class SearchIndex {}
class SearchClient {
  static connect(_url: string): Promise<SearchClient> {
    return Promise.resolve(new SearchClient());
  }
  warm(): Promise<void> {
    return Promise.resolve();
  }
}
class Cache {
  warm(_keys: string[]): Promise<void> {
    return Promise.resolve();
  }
}
class Redis {
  quit(): Promise<void> {
    return Promise.resolve();
  }
}

// --- The lifecycle (all four hooks) ----------------------------------------
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.bind("clock", () => new Date().toISOString());
  }

  boot(): void {
    // Phase 2 — safe to resolve.
  }

  async ready(): Promise<void> {
    await this.app.make(Cache).warm(["home", "pricing"]);
  }

  async shutdown(): Promise<void> {
    await this.app.make(Redis).quit();
  }
}

// --- The `app` reference ---------------------------------------------------
export class SearchServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton("search", () => new SearchIndex());
  }

  boot(): void {
    const debug = this.app.config().get("app.debug", false);
    this.app.router().get("/health", () => "ok");
    void debug;
  }
}

// --- A realistic example ---------------------------------------------------
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

// --- Async providers -------------------------------------------------------
export class AsyncSearchProvider extends ServiceProvider {
  async register(): Promise<void> {
    const client = await SearchClient.connect("https://search.example");
    this.app.instance(SearchClient, client);
  }

  async boot(): Promise<void> {
    await this.app.make(SearchClient).warm();
  }
}

// --- Registering a provider ------------------------------------------------
export const providers: ProviderClass[] = [
  AppServiceProvider,
  BillingServiceProvider,
];

// --- Booting the providers -------------------------------------------------
export async function bootApp(): Promise<Application> {
  const app = new Application();
  app.register(AppServiceProvider);
  return app.boot(providers);
}

// --- Parameterized providers (plugin-style options) ------------------------
export class RateLimitProvider extends ServiceProvider<{ max: number }> {
  boot(): void {
    const max: number = this.options.max; // typed via the generic
    void max;
  }
}

export async function registerWithOptions(): Promise<Application> {
  const app = new Application();
  app.register(RateLimitProvider, { max: 100 });
  app.register(RateLimitProvider, { max: 20 }); // again, different options
  return app.boot([], { discoverConfig: false, config: { app: {} } });
}

// --- ProviderClass as a value ----------------------------------------------
const provider: ProviderClass = SearchServiceProvider;
export { provider };
