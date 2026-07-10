/**
 * The Application is the container plus a lifecycle: it loads env + config,
 * registers service providers, then boots them. This is Keel's kernel.
 *
 * The core is platform-neutral: Node built-ins (fs/path/url) and dotenv are
 * imported dynamically and only when filesystem discovery is enabled, so the
 * same Application runs under Node and on Cloudflare Workers. On Workers, call
 * `boot(providers, { discoverConfig: false, config })` and pass config inline.
 */

import { Container } from "./container.js";
import { Config, type ConfigData } from "./config.js";
import { Router } from "./http/router.js";
import { View } from "./view.js";
import { Events } from "./events.js";
import { Cache } from "./cache.js";
import { ServiceProvider, type ProviderClass } from "./provider.js";
import { setApplication } from "./helpers.js";

export interface BootOptions {
  /** Auto-load .env and config/*.ts from the filesystem. Default: true (Node). */
  discoverConfig?: boolean;
  /** Config to merge in directly — the way to configure on Workers. */
  config?: ConfigData;
}

export class Application extends Container {
  private providers: ServiceProvider[] = [];
  private booted = false;

  constructor(public readonly basePath: string = ".") {
    super();

    // Make this the active application for global helpers (config(), app()).
    setApplication(this);

    // Core framework bindings (all platform-neutral).
    this.instance(Application, this);
    this.singleton(Config, () => new Config());
    this.singleton(Router, (app) => new Router(app));
    this.singleton(View, () => new View());
    this.singleton(Events, () => new Events());
    this.singleton(Cache, () => new Cache());
  }

  path(...segments: string[]): string {
    return [this.basePath, ...segments].join("/");
  }

  config(): Config {
    return this.make(Config);
  }

  router(): Router {
    return this.make(Router);
  }

  view(): View {
    return this.make(View);
  }

  /** Merge a config object into the repository under its top-level keys. */
  private mergeConfig(data: ConfigData): void {
    const repo = this.make(Config);
    for (const [key, value] of Object.entries(data)) {
      repo.set(key, value);
    }
  }

  /** Load .env via dotenv (Node only; no-op elsewhere). */
  private async loadEnv(): Promise<void> {
    try {
      const [{ config }, { join }] = await Promise.all([
        import("dotenv"),
        import("node:path"),
      ]);
      config({ path: join(this.basePath, ".env") });
    } catch {
      // Not on Node / no dotenv — fine.
    }
  }

  /** Load every /config/*.ts file under its filename key (Node only). */
  private async loadConfig(): Promise<void> {
    try {
      const [{ readdir }, { join }, { pathToFileURL }] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
        import("node:url"),
      ]);

      const dir = this.path("config");
      const repo = this.make(Config);
      const files = await readdir(dir);

      for (const file of files) {
        if (!/\.(ts|js|mjs)$/.test(file)) continue;
        const key = file.replace(/\.(ts|js|mjs)$/, "");
        const mod = await import(pathToFileURL(join(dir, file)).href);
        repo.set(key, mod.default ?? mod);
      }
    } catch {
      // No config dir or not on Node — fine.
    }
  }

  /** Register a provider instance (defers boot until boot()). */
  register(Provider: ProviderClass): this {
    const provider = new Provider(this);
    this.providers.push(provider);
    return this;
  }

  /** Load config, register providers, then boot them. */
  async boot(
    providers: ProviderClass[] = [],
    options: BootOptions = {},
  ): Promise<this> {
    if (this.booted) return this;

    const { discoverConfig = true, config } = options;

    if (discoverConfig) {
      await this.loadEnv();
      await this.loadConfig();
    }
    if (config) {
      this.mergeConfig(config);
    }

    for (const Provider of providers) {
      this.register(Provider);
    }
    for (const provider of this.providers) {
      await provider.register();
    }
    for (const provider of this.providers) {
      await provider.boot();
    }

    this.booted = true;
    return this;
  }
}
