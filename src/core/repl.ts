/**
 * An interactive shell with the application booted — `keel repl`.
 *
 *   keel repl
 *   > await db("users").get()
 *   > make(Router).all()
 *   > .ls
 *
 * The point is that everything is *already wired*: the container is booted, the
 * providers have run, and the global helpers are in scope. Poking at a model in a
 * REPL is the fastest debugging loop there is, and it shouldn't cost you a
 * throwaway script to get one.
 *
 * `node:repl` is imported dynamically, so the core still loads on the edge (where
 * there is, of course, no REPL to start).
 */

import type { Application } from "./application.js";

/** A helper exposed in the REPL, listed by `.ls`. */
export interface ReplHelper {
  name: string;
  description: string;
  value: unknown;
}

/** Extra helpers to put in scope, beyond the defaults. */
export interface ReplOptions {
  helpers?: ReplHelper[];
  /** The prompt string. Default: `"keel > "`. */
  prompt?: string;
}

/** The helpers every Keel REPL gets. */
async function defaultHelpers(app: Application): Promise<ReplHelper[]> {
  const core = await import("./index.js");

  const helpers: ReplHelper[] = [
    { name: "app", description: "The booted Application", value: app },
    { name: "config", description: "config(key, fallback?)", value: core.config },
    { name: "make", description: "Resolve a binding from the container", value: core.make },
    { name: "db", description: "Start a query: db('users').where(…)", value: core.db },
    { name: "cache", description: "The cache", value: core.cache },
    { name: "logger", description: "The logger", value: core.logger },
    { name: "events", description: "The event emitter", value: core.events },
    { name: "mail", description: "Start a message", value: core.mail },
    { name: "dispatch", description: "Dispatch a job", value: core.dispatch },
    { name: "storage", description: "The default disk", value: core.storage },
    { name: "router", description: "The router", value: app.make(core.Router) },
    { name: "hash", description: "Password hashing", value: core.hash },
    { name: "jwt", description: "JWT sign/verify", value: core.jwt },
    {
      name: "p",
      description: "Await a promise and print the result — p(db('users').get())",
      value: async (value: unknown) => await value,
    },
  ];

  return helpers;
}

/**
 * Start the REPL. Resolves when the user exits it.
 */
export async function startRepl(app: Application, options: ReplOptions = {}): Promise<void> {
  const [{ start }, { join }] = await Promise.all([import("node:repl"), import("node:path")]);

  const helpers = [...(await defaultHelpers(app)), ...(options.helpers ?? [])];

  const name = app.config().get("app.name", "Keel");
  console.log(`⚓ ${name} — type .ls to see what's in scope, .exit to leave.\n`);

  const server = start({
    prompt: options.prompt ?? "keel > ",
    useColors: true,
    // Await at the top level, so `> await db("users").get()` just works.
    useGlobal: false,
    breakEvalOnSigint: true,
  });

  for (const helper of helpers) {
    Object.defineProperty(server.context, helper.name, {
      configurable: false,
      enumerable: true,
      value: helper.value,
    });
  }

  // History, so the last thing you typed survives a restart.
  try {
    await new Promise<void>((resolve) => {
      server.setupHistory(join(app.basePath, ".keel_repl_history"), () => resolve());
    });
  } catch {
    // No history file — not worth failing the REPL over.
  }

  server.defineCommand("ls", {
    help: "List everything in scope",
    action() {
      const width = Math.max(...helpers.map((h) => h.name.length));
      for (const helper of helpers) {
        console.log(`  ${helper.name.padEnd(width + 2)}${helper.description}`);
      }
      this.displayPrompt();
    },
  });

  return new Promise<void>((resolve) => {
    server.on("exit", () => {
      void app.terminate().finally(() => resolve());
    });
  });
}
