// Type-check harness for docs/configuration.md. Every type-checkable snippet in
// the guide is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import {
  env,
  config,
  app,
  Config,
  type ConfigData,
} from "@shaferllc/keel/core";

// A stand-in for a user's service, used only for `app().make(...)`.
class SomeService {}

export function envHelper() {
  const name = env("APP_NAME"); // string
  const debug = env("APP_DEBUG", false); // boolean
  const port = env("APP_PORT", 3000); // number
  const fallback = env("MISSING", "default"); // string

  const portStr = env("APP_PORT"); // string (no numeric fallback)
  const portNum = env("APP_PORT", 0); // number
  const debugBool = env("APP_DEBUG"); // string (declared) / boolean (runtime)

  return { name, debug, port, fallback, portStr, portNum, debugBool };
}

// config/app.ts — a config file's default export.
export function configFile() {
  return {
    name: env("APP_NAME", "Keel"),
    env: env("APP_ENV", "local"),
    debug: env("APP_DEBUG", true),
    url: env("APP_URL", "http://localhost:3000"),
    port: env("APP_PORT", 3000),
  };
}

export function readingConfig() {
  const a = config("app.name"); // unknown
  const b = config("app.port", 3000); // number
  const c = config("services.stripe.key"); // unknown
  const d = config<number>("app.port", 3000);
  const e = config("services.stripe.key", ""); // string
  const f = config("nope.at.all"); // unknown | undefined
  return { a, b, c, d, e, f };
}

export function containerHelper() {
  app().make(SomeService);
  app().config().get("app.name");
}

export function longForm() {
  const cfg = app().make(Config);

  cfg.get("app.name");
  cfg.get("app.port", 3000);
  cfg.get("services.stripe.key");
  cfg.get<string>("services.stripe.key");
  cfg.set("app.debug", false);
  cfg.all();

  if (cfg.get("services.stripe.key") !== undefined) {
    // configured
  }
}

export function configClass() {
  const repo = new Config({ app: { name: "Keel", port: 3000 } });
  const port = repo.get("app.port"); // unknown
  repo.set("services.stripe.key", "sk_test_…"); // creates `services`
  const tree: ConfigData = repo.all();
  return { port, tree };
}

// Interface / type seams
const data: ConfigData = {
  app: { name: "Keel", port: 3000 },
};
export { data };

/* --- Environment validation --- */

import { defineEnv, envVar, EnvValidationError } from "@shaferllc/keel/core";

export const validated = defineEnv({
  APP_KEY: envVar.string({ required: true, description: "32+ random characters" }),
  PORT: envVar.number({ default: 3000 }),
  NODE_ENV: envVar.enum(["development", "test", "production"], { default: "development" }),
  DATABASE_URL: envVar.url({ required: true }),
  DEBUG: envVar.boolean({ default: false }),
  SENTRY_DSN: envVar.string(),
});

export function typedValues() {
  const key: string = validated.APP_KEY;
  const port: number = validated.PORT;
  const mode: "development" | "test" | "production" = validated.NODE_ENV;
  const debug: boolean = validated.DEBUG;
  const dsn: string | undefined = validated.SENTRY_DSN;
  const url: string = validated.DATABASE_URL;

  return { key, port, mode, debug, dsn, url };
}

export function withCustomValidation() {
  return defineEnv(
    {
      APP_KEY: envVar.string({
        required: true,
        validate: (value) => (value.length >= 32 ? true : "must be at least 32 characters"),
      }),
    },
    { source: { APP_KEY: "x".repeat(32) } },
  );
}

export function handlingTheFailure(error: unknown): string[] {
  return error instanceof EnvValidationError ? error.problems : [];
}
