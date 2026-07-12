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
import { serve } from "@hono/node-server";
import { Command } from "commander";

import { createApplication } from "../../../bootstrap/app.js";
import { ConsoleKernel, type AnyCommand } from "../console.js";
import type { Application } from "../application.js";
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

async function generate(relPath: string, contents: string, label: string) {
  const full = join(basePath, relPath);
  try {
    await access(full);
    console.error(`✗ ${label} already exists: ${relPath}`);
    process.exitCode = 1;
    return;
  } catch {
    // does not exist — proceed
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents);
  console.log(`✓ Created ${label}: ${relPath}`);
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
async function publishPath(from: string, toRel: string, force: boolean): Promise<void> {
  const dest = join(basePath, toRel);
  const s = await stat(from).catch(() => null);
  if (!s) {
    console.error(`✗ Source not found: ${from}`);
    return;
  }
  if (s.isDirectory()) {
    for (const item of await readdir(from)) {
      await publishPath(join(from, item), join(toRel, item), force);
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
    console.log(`• Skipped ${toRel} (exists; pass --force to overwrite)`);
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(from, dest);
  console.log(`✓ Published ${toRel}`);
}

export async function run(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("keel").description("Keel framework console").version("0.1.0");

  // Boot the app once so commands share it, and so package providers get a
  // chance to contribute migrations, commands, and publishables. Scaffolding
  // commands (`make:*`) don't need it, so a boot failure isn't fatal — it's
  // surfaced only when a command that needs the app actually runs.
  let app: Application | null = null;
  let bootError: unknown;
  try {
    app = await createApplication();
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
   * `app/Commands`. They run on the console kernel — typed args and flags,
   * prompts, and the terminal UI — rather than through the wrapper below.
   */
  async function appCommands(): Promise<AnyCommand[]> {
    const dir = join(basePath, "app/Commands");
    const found: AnyCommand[] = [];

    const { readdir } = await import("node:fs/promises");
    const { pathToFileURL } = await import("node:url");

    // No app/Commands at all is fine — that's the only thing we swallow.
    const files = await readdir(dir).catch(() => null);
    if (!files) return found;

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

  // An app command wins over the built-ins, so you can override one.
  const commands = await appCommands();
  const name = argv[2];

  if (name && commands.some((c) => c.name === name || c.aliases?.includes(name))) {
    const kernel = new ConsoleKernel({ binary: "keel" }).register(...commands);
    process.exitCode = await kernel.run(argv.slice(2));
    return;
  }

  program
    .command("repl")
    .description("An interactive shell with the application booted")
    .action(async () => {
      const app = requireApp();
      const { startRepl } = await import("../repl.js");
      await startRepl(app);
    });

  program
    .command("serve")
    .description("Start the HTTP server")
    .option("-p, --port <port>", "port to listen on")
    .action(async (opts) => {
      const app = requireApp();
      const kernel = app.bound(HttpKernel)
        ? app.make(HttpKernel)
        : new HttpKernel(app);
      const hono = kernel.build();
      const port = Number(
        opts.port ?? app.config().get("app.port", 3000),
      );
      const server = serve({ fetch: hono.fetch, port }, (info) => {
        const name = app.config().get("app.name", "Keel");
        console.log(`⚓ ${name} listening on http://localhost:${info.port}`);
      });

      // Graceful shutdown: stop accepting connections, run the app's shutdown
      // hooks (and every provider's shutdown()), then exit. `once` so a second
      // signal isn't swallowed if cleanup hangs — hit Ctrl-C again to force it.
      const shutdown = async (signal: string) => {
        console.log(`\n${signal} received — shutting down…`);
        server.close();
        try {
          await app.terminate();
        } catch (err) {
          console.error("Error during shutdown:", err);
          process.exit(1);
        }
        process.exit(0);
      };
      process.once("SIGINT", () => void shutdown("SIGINT"));
      process.once("SIGTERM", () => void shutdown("SIGTERM"));
    });

  program
    .command("mcp")
    .description("Start the MCP server (exposes Keel docs, API, and generators to AI agents over stdio)")
    .action(async () => {
      const { runMcpServer } = await import("../../mcp/server.js");
      await runMcpServer();
    });

  program
    .command("routes")
    .description("List registered routes")
    .action(async () => {
      const app = requireApp();
      const router = app.make(Router);
      const rows = router.all();
      if (rows.length === 0) {
        console.log("No routes registered.");
        return;
      }
      for (const r of rows) {
        const handler = Array.isArray(r.handler)
          ? `${r.handler[0].name}@${r.handler[1]}`
          : r.handler instanceof Response
            ? "Static"
            : "Closure";
        const verbs = r.methods.join("|");
        const named = r.name ? `  (${r.name})` : "";
        console.log(`${verbs.padEnd(12)} ${r.path.padEnd(24)} ${handler}${named}`);
      }
    });

  program
    .command("make:controller <name>")
    .description("Generate a controller")
    .option("-r, --resource", "generate a RESTful resource controller")
    .action(async (name: string, opts: { resource?: boolean }) => {
      const cls = className(name, "Controller");
      const stub = opts.resource ? resourceControllerStub(cls) : controllerStub(cls);
      await generate(`app/Controllers/${cls}.ts`, stub, "Controller");
    });

  program
    .command("make:provider <name>")
    .description("Generate a service provider")
    .action(async (name: string) => {
      const cls = className(name, "ServiceProvider");
      await generate(`app/Providers/${cls}.ts`, providerStub(cls), "Provider");
    });

  program
    .command("make:middleware <name>")
    .description("Generate an HTTP middleware")
    .action(async (name: string) => {
      const cls = className(name, "Middleware");
      const file = cls.charAt(0).toLowerCase() + cls.slice(1);
      await generate(`app/Http/Middleware/${file}.ts`, middlewareStub(cls), "Middleware");
    });

  program
    .command("make:factory <model>")
    .description("Generate a model factory")
    .action(async (model: string) => {
      const cls = className(model, "");
      await generate(`database/factories/${cls}Factory.ts`, factoryStub(cls), "Factory");
    });

  program
    .command("make:seeder <name>")
    .description("Generate a database seeder")
    .action(async (name: string) => {
      const cls = className(name, "Seeder");
      await generate(`database/seeders/${cls}.ts`, seederStub(cls), "Seeder");
    });

  program
    .command("make:job <name>")
    .description("Generate a queued job")
    .action(async (name: string) => {
      const cls = className(name, "Job");
      await generate(`app/Jobs/${cls}.ts`, jobStub(cls), "Job");
    });

  program
    .command("make:page <path>")
    .description("Generate a page (its path is its URL): make:page users/[id]")
    .action(async (path: string) => {
      // The path IS the route, so it's used verbatim — no class-name munging.
      const file = path.replace(/^\/+/, "").replace(/\.(tsx|jsx)$/, "");
      await generate(`resources/pages/${file}.tsx`, pageStub(file), "Page");
    });

  program
    .command("make:command <name>")
    .description("Generate a console command (typed args + flags, prompts, UI)")
    .action(async (name: string) => {
      const file = name.replace(/[^a-zA-Z0-9:_-]/g, "");
      await generate(`app/Commands/${file.replace(/:/g, "-")}.ts`, commandStub(file), "Command");
    });

  program
    .command("make:notification <name>")
    .description("Generate a notification")
    .action(async (name: string) => {
      const cls = className(name, "Notification");
      await generate(`app/Notifications/${cls}.ts`, notificationStub(cls), "Notification");
    });

  program
    .command("make:transformer <name>")
    .description("Generate an API transformer")
    .option("-m, --model <model>", "the value it maps (e.g. User)")
    .action(async (name: string, opts: { model?: string }) => {
      const cls = className(name, "Transformer");
      const model = opts.model ? className(opts.model, "") : cls.replace(/Transformer$/, "");
      await generate(`app/Transformers/${cls}.ts`, transformerStub(cls, model), "Transformer");
    });

  program
    .command("make:package <name>")
    .description("Scaffold a Keel package (a PackageProvider skeleton)")
    .action(async (name: string) => {
      const slug = name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const cls = slug.charAt(0).toUpperCase() + slug.slice(1);
      await generate(
        `packages/${slug}/${cls}ServiceProvider.ts`,
        packageProviderStub(slug),
        "Package",
      );
    });

  program
    .command("migrate")
    .description("Run pending database migrations (app + package)")
    .action(async () => {
      const app = requireApp();
      try {
        const applied = await migratorFor().up(await collectMigrations(app));
        if (!applied.length) console.log("Nothing to migrate.");
        else for (const name of applied) console.log(`✓ Migrated ${name}`);
      } catch (err) {
        console.error(`✗ Migration failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("migrate:rollback")
    .description("Roll back the most recent batch of migrations")
    .action(async () => {
      const app = requireApp();
      try {
        const rolled = await migratorFor().down(await collectMigrations(app));
        if (!rolled.length) console.log("Nothing to roll back.");
        else for (const name of rolled) console.log(`✓ Rolled back ${name}`);
      } catch (err) {
        console.error(`✗ Rollback failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("migrate:status")
    .description("Show which migrations have run and which are pending")
    .action(async () => {
      const app = requireApp();
      try {
        const migrator = migratorFor();
        const ran = new Set(await migrator.ran());
        const migrations = await collectMigrations(app);
        if (!migrations.length) {
          console.log("No migrations found.");
          return;
        }
        for (const m of migrations) {
          console.log(`${ran.has(m.name) ? "✓ ran    " : "· pending"}  ${m.name}`);
        }
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("vendor:publish")
    .description("Copy package-published files (config, assets) into this app")
    .option("--tag <tag>", "only publish files under this tag")
    .option("--force", "overwrite files that already exist")
    .action(async (opts: { tag?: string; force?: boolean }) => {
      const app = requireApp();
      const registry = app.make(PublishRegistry);
      const entries = registry.all(opts.tag);
      if (!entries.length) {
        const tags = registry.tags();
        console.log(
          opts.tag
            ? `Nothing published under tag "${opts.tag}".`
            : "Nothing to publish.",
        );
        if (!opts.tag && tags.length) console.log(`Available tags: ${tags.join(", ")}`);
        return;
      }
      for (const entry of entries) {
        for (const [from, to] of Object.entries(entry.files)) {
          await publishPath(from, to, Boolean(opts.force));
        }
      }
    });

  // Mount package-contributed commands (e.g. `watch:prune`) gathered at boot.
  if (app) {
    for (const cmd of app.make(CommandRegistry).all()) {
      const command = program.command(cmd.name);
      if (cmd.description) command.description(cmd.description);
      cmd.configure?.(command);
      command.action((opts: Record<string, unknown>, c: Command) => cmd.action(opts, c));
    }
  }

  await program.parseAsync(argv);
}
