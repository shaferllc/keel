/**
 * The package system. Keel's `ServiceProvider` is already its plugin unit —
 * `PackageProvider` is the same thing with batteries for the jobs a *shippable*
 * package does over and over: merge its config defaults, register its routes and
 * bundled UI assets, contribute migrations and console commands, and declare
 * files a consuming app can publish. Each helper is a thin wrapper over an
 * existing Keel primitive; the value is the convention, not new machinery.
 *
 *   export class WatchServiceProvider extends PackageProvider {
 *     readonly name = "watch";
 *     register() {
 *       this.mergeConfig("watch", defaultConfig);
 *       this.migrations([watchMigration]);
 *       this.publishes({ [stub]: "config/watch.ts" }, "watch-config");
 *     }
 *     boot() {
 *       this.assets("watch/assets", uiDir, { immutable: true });
 *       this.routes((r) => registerWatchRoutes(r), { prefix: "watch", as: "watch" });
 *     }
 *   }
 *
 * A note on lifecycle: register/boot run *before* the app's HTTP kernel is bound
 * (see `bootstrap/app.ts`), so a package must not reach for the kernel. That's
 * why `routes()` and `assets()` go through the `Router` (bound in the
 * Application constructor) — routes are compiled onto the kernel later, at build.
 */

import type { MiddlewareHandler } from "hono";
import { getMimeType } from "hono/utils/mime";
import type { Command } from "commander";

import { ServiceProvider } from "./provider.js";
import type { Application } from "./application.js";
import type { Router, RouteGroup, MiddlewareRef, RouteHandler, Ctx } from "./http/router.js";
import type { Migration } from "./migrations.js";
import { NotFoundException } from "./exceptions.js";

/* ------------------------------- registries ------------------------------- */

/**
 * Every migration a package contributes, gathered in one place so `keel migrate`
 * can run them alongside the app's own. Bound as a singleton on the Application.
 */
export class MigrationRegistry {
  private list: Migration[] = [];
  add(migrations: Migration[]): void {
    this.list.push(...migrations);
  }
  all(): Migration[] {
    return [...this.list];
  }
}

/** A console command a package adds to `keel`. */
export interface PackageCommand {
  /** The command name, e.g. `"watch:prune"`. */
  name: string;
  description?: string;
  /** Add arguments/options to the commander command before its action. */
  configure?: (cmd: Command) => void;
  /** What the command does. Receives parsed options and the command. */
  action: (opts: Record<string, unknown>, cmd: Command) => void | Promise<void>;
}

/** Package-contributed console commands, mounted by the CLI after boot. */
export class CommandRegistry {
  private list: PackageCommand[] = [];
  add(commands: PackageCommand[]): void {
    this.list.push(...commands);
  }
  all(): PackageCommand[] {
    return [...this.list];
  }
}

/** One `publishes()` declaration: source→destination files, optionally tagged. */
export interface PublishEntry {
  package: string;
  tag?: string;
  /** Absolute-or-package source path → app-relative destination path. */
  files: Record<string, string>;
}

/** What `keel vendor:publish` copies into a consuming app. */
export class PublishRegistry {
  private entries: PublishEntry[] = [];
  add(entry: PublishEntry): void {
    this.entries.push(entry);
  }
  all(tag?: string): PublishEntry[] {
    return tag ? this.entries.filter((e) => e.tag === tag) : [...this.entries];
  }
  tags(): string[] {
    return [...new Set(this.entries.map((e) => e.tag).filter((t): t is string => !!t))];
  }
}

/* --------------------------------- helpers -------------------------------- */

/** Deep-merge two plain objects; `override` wins, arrays are replaced wholesale. */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface PackageRouteOptions {
  /** Mount every route under this path prefix. */
  prefix?: string;
  /** Middleware to run before every route in the group. */
  middleware?: MiddlewareRef | MiddlewareRef[];
  /** Prefix every named route with `<as>.`. */
  as?: string;
}

export interface PackageAssetOptions {
  /** Cache-Control max-age (seconds). */
  maxAge?: number;
  /** Add `immutable` — for content-hashed filenames. */
  immutable?: boolean;
}

/**
 * A route handler that serves files from `dir` for requests under `prefix`. Used
 * by `PackageProvider.assets()` so a package can ship a built UI without the
 * consuming app copying anything into `public/`. Node-only (uses `node:fs`);
 * a miss becomes a 404 so it doesn't shadow real routes.
 */
function packageAssetHandler(
  prefix: string,
  dir: string,
  options: PackageAssetOptions,
): RouteHandler {
  const root = dir.replace(/\/+$/, "");
  return async (c: Ctx): Promise<Response> => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const rel = pathname.slice(prefix.length).replace(/^\/+/, "");
    if (rel.includes("..")) throw new NotFoundException();

    const { stat, readFile } = await import("node:fs/promises");
    const filePath = `${root}/${rel}`;
    const stats = await stat(filePath).catch(() => null);
    if (!stats?.isFile()) throw new NotFoundException();

    const headers: Record<string, string> = {
      "Content-Type": getMimeType(filePath) ?? "application/octet-stream",
    };
    if (options.maxAge != null) {
      headers["Cache-Control"] =
        `public, max-age=${options.maxAge}${options.immutable ? ", immutable" : ""}`;
    }
    return new Response(await readFile(filePath), { headers });
  };
}

/* ----------------------------- PackageProvider ---------------------------- */

export abstract class PackageProvider<O = Record<string, unknown>> extends ServiceProvider<O> {
  /** The package's short name — used for publish grouping and diagnostics. */
  abstract readonly name: string;

  constructor(app: Application, options?: O) {
    super(app, options);
  }

  /**
   * Set config defaults under `key` without clobbering what the app already
   * configured. Config files load before providers, so the app's `config/<key>.ts`
   * (if any) is deep-merged *over* these defaults — the app always wins.
   */
  protected mergeConfig(key: string, defaults: Record<string, unknown>): void {
    const cfg = this.app.config();
    const existing = cfg.get<Record<string, unknown> | undefined>(key);
    cfg.set(key, isPlainObject(existing) ? deepMerge(defaults, existing) : defaults);
  }

  /**
   * Register a group of routes. The callback receives the `Router`; the returned
   * `RouteGroup` is already prefixed/guarded/named per `options`, and chainable
   * for anything more.
   */
  protected routes(register: (router: Router) => void, options: PackageRouteOptions = {}): RouteGroup {
    const router = this.app.router();
    const group = router.group(() => register(router));
    if (options.prefix) group.prefix(options.prefix);
    if (options.middleware) group.middleware(options.middleware);
    if (options.as) group.as(options.as);
    return group;
  }

  /**
   * Serve a directory of static files (a bundled UI, images, …) under a URL
   * prefix. Node-only. Mounts one wildcard route on the `Router`.
   */
  protected assets(urlPrefix: string, dir: string, options: PackageAssetOptions = {}): void {
    const prefix = "/" + urlPrefix.replace(/^\/|\/$/g, "");
    this.app.router().get(`${prefix}/*`, packageAssetHandler(prefix, dir, options));
  }

  /** Contribute migrations, run by `keel migrate` with the app's own. */
  protected migrations(list: Migration[]): void {
    this.app.make(MigrationRegistry).add(list);
  }

  /** Contribute console commands, mounted on `keel` after the app boots. */
  protected commands(list: PackageCommand[]): void {
    this.app.make(CommandRegistry).add(list);
  }

  /**
   * Declare files a consuming app can copy into itself with
   * `keel vendor:publish` (optionally `--tag <tag>`): config stubs, views, etc.
   * Keys are source paths (usually inside the package), values app-relative
   * destinations.
   */
  protected publishes(files: Record<string, string>, tag?: string): void {
    this.app.make(PublishRegistry).add({ package: this.name, ...(tag ? { tag } : {}), files });
  }
}

/** A middleware alias, re-exported so packages needn't reach into `hono`. */
export type PackageMiddleware = MiddlewareHandler;
