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

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";

import { createApplication } from "../../../bootstrap/app.js";
import { HttpKernel } from "../http/kernel.js";
import { Router } from "../http/router.js";
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

export async function run(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("keel").description("Keel framework console").version("0.1.0");

  program
    .command("serve")
    .description("Start the HTTP server")
    .option("-p, --port <port>", "port to listen on")
    .action(async (opts) => {
      const app = await createApplication();
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
      const app = await createApplication();
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

  await program.parseAsync(argv);
}
