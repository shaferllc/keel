/**
 * Keel Watch — a Telescope-style debug dashboard, shipped as a Keel package.
 *
 * One line in `bootstrap/providers.ts` turns it on:
 *   app.register(WatchServiceProvider)
 *
 * It's the reference consumer of the package system: it merges its own config,
 * contributes a migration, mounts routes and a bundled SPA, and adds a console
 * command — all through `PackageProvider` helpers, touching no framework
 * internals. The watchers observe the instrumentation event stream; they patch
 * nothing, so installing Watch changes no behaviour, only visibility.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PackageProvider } from "../core/package.js";
import type { Router } from "../core/http/router.js";
import { resolveConfig, defaultConfig, type WatchConfig } from "./config.js";
import { MemoryStore, DatabaseStore, type EntryStore } from "./store.js";
import { watchMigration } from "./migration.js";
import { Recorder } from "./recorder.js";
import { installWatchers } from "./watchers.js";
import { registerWatchRoutes } from "./routes.js";
import { pruneCommand } from "./prune.js";

const here = dirname(fileURLToPath(import.meta.url));

export class WatchServiceProvider extends PackageProvider {
  readonly name = "watch";

  private config!: WatchConfig;
  private store!: EntryStore;
  private teardown?: () => void;

  register(): void {
    this.mergeConfig("watch", defaultConfig as unknown as Record<string, unknown>);
    this.config = resolveConfig();
    this.store =
      this.config.storage === "memory"
        ? new MemoryStore(this.config.limit * 10)
        : new DatabaseStore(this.config.table, this.config.connection);

    // Schema (run by `keel migrate`), a publishable config stub, and the CLI.
    this.migrations([watchMigration(this.config.table)]);
    this.publishes({ [join(here, "watch.config.stub")]: "config/watch.ts" }, "watch-config");
    this.commands([pruneCommand(this.store, this.config)]);
  }

  boot(): void {
    if (!this.config.enabled) return;

    // Observe the instrumentation stream.
    this.teardown = installWatchers(new Recorder(this.store, this.config), this.config);

    // Serve the dashboard: the bundled SPA, the JSON API, and the shell.
    const base = "/" + this.config.path.replace(/^\/|\/$/g, "");
    const assetsUrl = `${base}/assets`;
    this.assets(`${this.config.path}/assets`, join(here, "ui/dist"), { maxAge: 3600 });
    this.routes((r: Router) => registerWatchRoutes(r, this.store, this.config, { base, assetsUrl }), {
      prefix: this.config.path,
      as: "watch",
    });
  }

  shutdown(): void {
    this.teardown?.();
  }
}
