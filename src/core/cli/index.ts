/**
 * The Keel console. `keel <command>`.
 *
 * Commands:
 *   keel serve                 start the HTTP server
 *   keel make:controller Foo   generate app/Controllers/FooController.ts
 *   keel make:provider Foo      generate app/Providers/FooServiceProvider.ts
 *   keel make:middleware Foo    generate app/Http/Middleware/foo.ts
 *   keel make:factory User      generate database/factories/UserFactory.ts
 *   keel make:seeder Database   generate database/seeders/DatabaseSeeder.ts
 *   keel make:job SendWelcome   generate app/Jobs/SendWelcomeJob.ts
 *   keel make:notification Paid generate app/Notifications/PaidNotification.ts
 *   keel make:transformer User  generate app/Transformers/UserTransformer.ts
 *   keel routes                 list registered routes
 *   keel mcp                    start the MCP server (docs + API for AI agents)
 */

import { mkdir, writeFile, access, readdir, stat, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { ConsoleKernel, defineCommand, arg, flag, type AnyCommand } from "../console.js";
import type { Application } from "../application.js";
import type { Ui } from "../console-ui.js";
import { HttpKernel } from "../http/kernel.js";
import { Router } from "../http/router.js";
import { getConnection } from "../database.js";
import { Migrator, type Migration } from "../migrations.js";
import { MigrationRegistry, CommandRegistry, PublishRegistry } from "../package.js";
import {
  controllerStub,
  resourceControllerStub,
  providerStub,
  middlewareStub,
  factoryStub,
  seederStub,
  jobStub,
  notificationStub,
  transformerStub,
  packageProviderStub,
  pageStub,
  commandStub,
} from "./stubs.js";

const basePath = process.cwd();

async function generate(relPath: string, contents: string, label: string, ui: Ui): Promise<void> {
  const full = join(basePath, relPath);
  try {
    await access(full);
    // Never clobber a file someone has written code in.
    ui.error(`${label} already exists: ${relPath}`);
    process.exitCode = 1;
    return;
  } catch {
    // does not exist — proceed
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
  ui.action("create", relPath);
}

/** Normalize "foo" / "FooController" into a canonical suffixed class name. */
function className(name: string, suffix: string): string {
  const base = name.replace(new RegExp(`${suffix}$`, "i"), "");
  const pascal = base.charAt(0).toUpperCase() + base.slice(1);
  return `${pascal}${suffix}`;
}

/** Load every migration under database/migrations/, in filename order. */
async function discoverMigrations(): Promise<Migration[]> {
  const dir = join(basePath, "database/migrations");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return []; // no migrations directory — fine
  }
  const out: Migration[] = [];
  for (const file of files.sort()) {
    if (!/\.(ts|js|mjs)$/.test(file)) continue;
    const mod = await import(pathToFileURL(join(dir, file)).href);
    const def = (mod.default ?? mod.migration ?? mod) as unknown;
    if (Array.isArray(def)) out.push(...(def as Migration[]));
    else if (def && typeof (def as Migration).up === "function") out.push(def as Migration);
  }
  return out;
}

/** Every migration to run: the app's discovered ones, then package-contributed. */
async function collectMigrations(app: Application): Promise<Migration[]> {
  return [...(await discoverMigrations()), ...app.make(MigrationRegistry).all()];
}

/** A `Migrator` on the default connection, or a friendly error if none is set. */
function migratorFor(): Migrator {
  const { connection, dialect } = getConnection(); // throws if no connection registered
  return new Migrator(connection, dialect);
}

/** Copy a published file/dir into the app, skipping existing files unless forced. */
async function publishPath(from: string, toRel: string, force: boolean, ui: Ui): Promise<void> {
  const dest = join(basePath, toRel);
  const s = await stat(from).catch(() => null);
  if (!s) {
    ui.error(`Source not found: ${from}`);
    return;
  }
  if (s.isDirectory()) {
    for (const item of await readdir(from)) {
      await publishPath(join(from, item), join(toRel, item), force, ui);
    }
    return;
  }
  let exists = false;
  try {
    await access(dest);
    exists = true;
  } catch {
    // destination is free
  }
  if (exists && !force) {
    ui.action("skip", `${toRel} (exists; pass --force to overwrite)`, "skipped");
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(from, dest);
  ui.action("publish", toRel);
}

/** What the console needs from your app: a way to build it. */
export interface ConsoleOptions {
  /**
   * Build and boot the application. The console is handed this rather than
   * importing it, because a framework that imports an *application* has its
   * dependency pointing the wrong way — and that one import is what kept this
   * file out of the published build for so long.
   */
  createApplication: () => Promise<Application>;
}

export async function run(argv: string[], options: ConsoleOptions): Promise<void> {
  // Boot the app once so commands share it, and so package providers get a
  // chance to contribute migrations, commands, and publishables. Scaffolding
  // commands (`make:*`) don't need it, so a boot failure isn't fatal — it's
  // surfaced only when a command that needs the app actually runs.
  let app: Application | null = null;
  let bootError: unknown;
  try {
    app = await options.createApplication();
  } catch (err) {
    bootError = err;
  }
  const requireApp = (): Application => {
    if (!app) {
      console.error("✗ Could not boot the application:");
      console.error(bootError);
      process.exit(1);
    }
    return app;
  };

  /**
   * Commands your app defines with `defineCommand()`, discovered from
   * `app/Commands`. They register alongside the built-ins — same kernel, same
   * typed args and flags — and an app command of the same name wins, so you can
   * override one.
   */
  async function appCommands(): Promise<AnyCommand[]> {
    const dir = join(basePath, "app/Commands");
    const found: AnyCommand[] = [];

    const files = await readdir(dir).catch(() => null);
    if (!files) return found; // no app/Commands — the only thing we swallow

    for (const file of files) {
      if (!/\.(ts|js|mjs)$/.test(file)) continue;

      let module: Record<string, unknown>;
      try {
        module = (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;
      } catch (error) {
        // A command file that won't load is a bug you need to see, not a command
        // that quietly doesn't exist.
        console.error(`✗ Could not load app/Commands/${file}:`);
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
        continue;
      }

      // Any export that looks like a command counts, so one file can hold several.
      for (const value of Object.values(module)) {
        const candidate = value as Partial<AnyCommand>;
        if (
          candidate &&
          typeof candidate === "object" &&
          typeof candidate.name === "string" &&
          typeof candidate.run === "function"
        ) {
          found.push(candidate as AnyCommand);
        }
      }
    }

    return found;
  }

  /* ------------------------------- the built-ins ------------------------------ */

  const serve = defineCommand({
    name: "serve",
    description: "Start the HTTP server",
    flags: { port: flag.number({ alias: "p", description: "port to listen on" }) },

    async run({ flags, ui }) {
      const application = requireApp();
      const kernel = application.bound(HttpKernel)
        ? application.make(HttpKernel)
        : new HttpKernel(application);
      const hono = kernel.build();
      const port = flags.port ?? Number(application.config().get("app.port", 3000));

      // Imported here, not at the top: the Node server is only needed to *serve*,
      // and the console must still load on a machine (or a Worker) that has no
      // reason to install it.
      const { serve: listen } = await import("@hono/node-server").catch(() => {
        throw new Error(
          "`keel serve` needs @hono/node-server. Install it: npm i @hono/node-server",
        );
      });

      const server = listen({ fetch: hono.fetch, port }, (info: { port: number }) => {
        ui.success(`${application.config().get("app.name", "Keel")} listening on http://localhost:${info.port}`);
      });

      // Graceful shutdown: stop accepting connections, run the app's shutdown
      // hooks (and every provider's shutdown()), then exit. `once` so a second
      // signal isn't swallowed if cleanup hangs — hit Ctrl-C again to force it.
      const shutdown = async (signal: string): Promise<void> => {
        ui.write(`\n${signal} received — shutting down…`);
        server.close();
        try {
          await application.terminate();
        } catch (err) {
          ui.error(`Error during shutdown: ${String(err)}`);
          process.exit(1);
        }
        process.exit(0);
      };
      process.once("SIGINT", () => void shutdown("SIGINT"));
      process.once("SIGTERM", () => void shutdown("SIGTERM"));

      // `serve` stays alive on purpose — the server is the command.
      await new Promise(() => {});
    },
  });

  const repl = defineCommand({
    name: "repl",
    description: "An interactive shell with the application booted",
    async run() {
      const { startRepl } = await import("../repl.js");
      await startRepl(requireApp());
    },
  });

  const mcp = defineCommand({
    name: "mcp",
    description: "Start the MCP server (Keel's docs, API, and generators, over stdio)",
    async run() {
      const { runMcpServer } = await import("../../mcp/server.js");
      await runMcpServer();
    },
  });

  const routes = defineCommand({
    name: "routes",
    description: "List registered routes",
    run({ ui }) {
      const rows = requireApp().make(Router).all();
      if (!rows.length) return void ui.info("No routes registered.");

      const table = ui.table(["Method", "Path", "Handler", "Name"]);
      for (const r of rows) {
        const handler = Array.isArray(r.handler)
          ? `${r.handler[0].name}@${r.handler[1]}`
          : r.handler instanceof Response
            ? "Static"
            : "Closure";
        table.row([r.methods.join("|"), r.path, handler, r.name ?? ""]);
      }
      table.render();
    },
  });

  /* -------------------------------- generators -------------------------------- */

  const makeController = defineCommand({
    name: "make:controller",
    description: "Generate a controller",
    args: { name: arg.string({ description: "e.g. Post" }) },
    flags: { resource: flag.boolean({ alias: "r", description: "a RESTful resource controller" }) },
    async run({ args, flags, ui }) {
      const cls = className(args.name, "Controller");
      const stub = flags.resource ? resourceControllerStub(cls) : controllerStub(cls);
      await generate(`app/Controllers/${cls}.ts`, stub, "Controller", ui);
    },
  });

  const makeProvider = defineCommand({
    name: "make:provider",
    description: "Generate a service provider",
    args: { name: arg.string() },
    async run({ args, ui }) {
      const cls = className(args.name, "ServiceProvider");
      await generate(`app/Providers/${cls}.ts`, providerStub(cls), "Provider", ui);
    },
  });

  const makeMiddleware = defineCommand({
    name: "make:middleware",
    description: "Generate an HTTP middleware",
    args: { name: arg.string() },
    async run({ args, ui }) {
      const cls = className(args.name, "Middleware");
      const file = cls.charAt(0).toLowerCase() + cls.slice(1);
      await generate(`app/Http/Middleware/${file}.ts`, middlewareStub(cls), "Middleware", ui);
    },
  });

  const makeFactory = defineCommand({
    name: "make:factory",
    description: "Generate a model factory",
    args: { model: arg.string({ description: "e.g. User" }) },
    async run({ args, ui }) {
      const cls = className(args.model, "");
      await generate(`database/factories/${cls}Factory.ts`, factoryStub(cls), "Factory", ui);
    },
  });

  const makeSeeder = defineCommand({
    name: "make:seeder",
    description: "Generate a database seeder",
    args: { name: arg.string() },
    async run({ args, ui }) {
      const cls = className(args.name, "Seeder");
      await generate(`database/seeders/${cls}.ts`, seederStub(cls), "Seeder", ui);
    },
  });

  const makeJob = defineCommand({
    name: "make:job",
    description: "Generate a queued job",
    args: { name: arg.string() },
    async run({ args, ui }) {
      const cls = className(args.name, "Job");
      await generate(`app/Jobs/${cls}.ts`, jobStub(cls), "Job", ui);
    },
  });

  const makePage = defineCommand({
    name: "make:page",
    description: "Generate a page — its path is its URL: make:page users/[id]",
    args: { path: arg.string({ description: "e.g. users/[id]" }) },
    async run({ args, ui }) {
      // The path IS the route, so it's used verbatim — no class-name munging.
      const file = args.path.replace(/^\/+/, "").replace(/\.(tsx|jsx)$/, "");
      await generate(`resources/pages/${file}.tsx`, pageStub(file), "Page", ui);
    },
  });

  const makeCommand = defineCommand({
    name: "make:command",
    description: "Generate a console command (typed args + flags, prompts, UI)",
    args: { name: arg.string() },
    async run({ args, ui }) {
      const file = args.name.replace(/[^a-zA-Z0-9:_-]/g, "");
      await generate(`app/Commands/${file.replace(/:/g, "-")}.ts`, commandStub(file), "Command", ui);
    },
  });

  const makeNotification = defineCommand({
    name: "make:notification",
    description: "Generate a notification",
    args: { name: arg.string() },
    async run({ args, ui }) {
      const cls = className(args.name, "Notification");
      await generate(`app/Notifications/${cls}.ts`, notificationStub(cls), "Notification", ui);
    },
  });

  const makeTransformer = defineCommand({
    name: "make:transformer",
    description: "Generate an API transformer",
    args: { name: arg.string() },
    flags: { model: flag.string({ alias: "m", description: "the value it maps (e.g. User)" }) },
    async run({ args, flags, ui }) {
      const cls = className(args.name, "Transformer");
      const model = flags.model ? className(flags.model, "") : cls.replace(/Transformer$/, "");
      await generate(`app/Transformers/${cls}.ts`, transformerStub(cls, model), "Transformer", ui);
    },
  });

  const makePackage = defineCommand({
    name: "make:package",
    description: "Scaffold a Keel package (a PackageProvider skeleton)",
    args: { name: arg.string() },
    async run({ args, ui }) {
      const slug = args.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const cls = slug.charAt(0).toUpperCase() + slug.slice(1);
      await generate(`packages/${slug}/${cls}ServiceProvider.ts`, packageProviderStub(slug), "Package", ui);
    },
  });

  /* -------------------------------- migrations -------------------------------- */

  const migrate = defineCommand({
    name: "migrate",
    description: "Run pending database migrations (app + package)",
    async run({ ui }) {
      const applied = await migratorFor().up(await collectMigrations(requireApp()));
      if (!applied.length) return void ui.info("Nothing to migrate.");
      for (const name of applied) ui.success(`Migrated ${name}`);
    },
  });

  const migrateRollback = defineCommand({
    name: "migrate:rollback",
    description: "Roll back the most recent batch of migrations",
    async run({ ui }) {
      const rolled = await migratorFor().down(await collectMigrations(requireApp()));
      if (!rolled.length) return void ui.info("Nothing to roll back.");
      for (const name of rolled) ui.success(`Rolled back ${name}`);
    },
  });

  const migrateStatus = defineCommand({
    name: "migrate:status",
    description: "Show which migrations have run and which are pending",
    async run({ ui }) {
      const migrator = migratorFor();
      const ran = new Set(await migrator.ran());
      const migrations = await collectMigrations(requireApp());

      if (!migrations.length) return void ui.info("No migrations found.");

      const table = ui.table(["Status", "Migration"]);
      for (const m of migrations) table.row([ran.has(m.name) ? "ran" : "pending", m.name]);
      table.render();
    },
  });

  const vendorPublish = defineCommand({
    name: "vendor:publish",
    description: "Copy package-published files (config, assets) into this app",
    flags: {
      tag: flag.string({ description: "only publish files under this tag" }),
      force: flag.boolean({ description: "overwrite files that already exist" }),
    },
    async run({ flags, ui }) {
      const registry = requireApp().make(PublishRegistry);
      const entries = registry.all(flags.tag);

      if (!entries.length) {
        ui.info(flags.tag ? `Nothing published under tag "${flags.tag}".` : "Nothing to publish.");
        const tags = registry.tags();
        if (!flags.tag && tags.length) ui.info(`Available tags: ${tags.join(", ")}`);
        return;
      }

      for (const entry of entries) {
        for (const [from, to] of Object.entries(entry.files)) {
          await publishPath(from, to, flags.force, ui);
        }
      }
    },
  });

  /* ---------------------------------- dispatch -------------------------------- */

  const kernel = new ConsoleKernel({ binary: "keel" }).register(
    serve as AnyCommand,
    repl as AnyCommand,
    mcp as AnyCommand,
    routes as AnyCommand,
    makeController as AnyCommand,
    makeProvider as AnyCommand,
    makeMiddleware as AnyCommand,
    makeFactory as AnyCommand,
    makeSeeder as AnyCommand,
    makeJob as AnyCommand,
    makePage as AnyCommand,
    makeCommand as AnyCommand,
    makeNotification as AnyCommand,
    makeTransformer as AnyCommand,
    makePackage as AnyCommand,
    migrate as AnyCommand,
    migrateRollback as AnyCommand,
    migrateStatus as AnyCommand,
    vendorPublish as AnyCommand,
  );

  // Package-contributed commands (a package's `commands([...])`), then the app's —
  // registered last, so an app command of the same name overrides anything above.
  if (app) kernel.register(...app.make(CommandRegistry).all());
  kernel.register(...(await appCommands()));

  process.exitCode = await kernel.run(argv.slice(2));
}
