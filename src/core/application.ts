/**
 * The Application is the container plus a lifecycle: it loads env + config,
 * registers service providers, then boots them. This is Keel's kernel.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";

import { Container } from "./container.js";
import { Config } from "./config.js";
import { Router } from "./http/router.js";
import { ServiceProvider, type ProviderClass } from "./provider.js";

export class Application extends Container {
  private providers: ServiceProvider[] = [];
  private booted = false;

  constructor(public readonly basePath: string) {
    super();
    loadDotenv({ path: join(basePath, ".env") });

    // Core framework bindings.
    this.instance(Application, this);
    this.singleton(Config, () => new Config());
    this.singleton(Router, (app) => new Router(app));
  }

  path(...segments: string[]): string {
    return join(this.basePath, ...segments);
  }

  config(): Config {
    return this.make(Config);
  }

  router(): Router {
    return this.make(Router);
  }

  /** Load every /config/*.ts file under its filename key. */
  private async loadConfig(): Promise<void> {
    const dir = this.path("config");
    const repo = this.make(Config);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return; // no config dir yet — fine
    }

    for (const file of files) {
      if (!/\.(ts|js|mjs)$/.test(file)) continue;
      const key = file.replace(/\.(ts|js|mjs)$/, "");
      const mod = await import(pathToFileURL(join(dir, file)).href);
      repo.set(key, mod.default ?? mod);
    }
  }

  /** Register a provider instance (defers boot until boot()). */
  register(Provider: ProviderClass): this {
    const provider = new Provider(this);
    this.providers.push(provider);
    return this;
  }

  /** Load config, register providers, then boot them. */
  async boot(providers: ProviderClass[] = []): Promise<this> {
    if (this.booted) return this;

    await this.loadConfig();

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
