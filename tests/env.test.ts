import { test } from "node:test";
import assert from "node:assert/strict";

import { defineEnv, envVar, EnvValidationError } from "../src/core/env.js";

/* -------------------------------- coercion -------------------------------- */

test("values are coerced to their declared type", () => {
  const env = defineEnv(
    {
      APP_KEY: envVar.string({ required: true }),
      PORT: envVar.number({ required: true }),
      DEBUG: envVar.boolean({ required: true }),
      DATABASE_URL: envVar.url({ required: true }),
      NODE_ENV: envVar.enum(["development", "test", "production"], { required: true }),
    },
    {
      source: {
        APP_KEY: "s3cret",
        PORT: "3000",
        DEBUG: "true",
        DATABASE_URL: "postgres://localhost/app",
        NODE_ENV: "production",
      },
    },
  );

  // Not "3000" — a number.
  assert.equal(env.PORT, 3000);
  assert.equal(typeof env.PORT, "number");

  assert.equal(env.DEBUG, true);
  assert.equal(typeof env.DEBUG, "boolean");

  assert.equal(env.APP_KEY, "s3cret");
  assert.equal(env.DATABASE_URL, "postgres://localhost/app");
  assert.equal(env.NODE_ENV, "production");
});

test("booleans accept the spellings people actually use", () => {
  for (const raw of ["true", "1", "yes", "on", "TRUE"]) {
    const env = defineEnv({ X: envVar.boolean({ required: true }) }, { source: { X: raw } });
    assert.equal(env.X, true, `"${raw}" should be true`);
  }

  for (const raw of ["false", "0", "no", "off", "FALSE"]) {
    const env = defineEnv({ X: envVar.boolean({ required: true }) }, { source: { X: raw } });
    assert.equal(env.X, false, `"${raw}" should be false`);
  }
});

/* -------------------------------- defaults -------------------------------- */

test("a default fills an absent variable", () => {
  const env = defineEnv(
    {
      PORT: envVar.number({ default: 3000 }),
      NODE_ENV: envVar.enum(["development", "production"], { default: "development" }),
      DEBUG: envVar.boolean({ default: false }),
    },
    { source: {} },
  );

  assert.equal(env.PORT, 3000);
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.DEBUG, false);
});

test("an empty string counts as absent — it's nearly always a mistake", () => {
  // PORT= in a .env file is a typo, not a deliberate empty port.
  const env = defineEnv({ PORT: envVar.number({ default: 3000 }) }, { source: { PORT: "" } });
  assert.equal(env.PORT, 3000);

  assert.throws(
    () => defineEnv({ APP_KEY: envVar.string({ required: true }) }, { source: { APP_KEY: "" } }),
    /APP_KEY is required but not set/,
  );
});

test("an optional variable with no default is undefined", () => {
  const env = defineEnv({ SENTRY_DSN: envVar.string() }, { source: {} });
  assert.equal(env.SENTRY_DSN, undefined);
});

/* -------------------------------- failures -------------------------------- */

test("a missing required variable refuses the boot", () => {
  assert.throws(
    () => defineEnv({ APP_KEY: envVar.string({ required: true }) }, { source: {} }),
    EnvValidationError,
  );
});

test("every problem is reported at once, not just the first", () => {
  try {
    defineEnv(
      {
        APP_KEY: envVar.string({ required: true }),
        PORT: envVar.number({ required: true }),
        NODE_ENV: envVar.enum(["development", "production"], { required: true }),
        DATABASE_URL: envVar.url({ required: true }),
      },
      { source: { PORT: "eighty", NODE_ENV: "staging", DATABASE_URL: "not a url" } },
    );
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);

    // Fixing a deploy one missing variable per restart is its own small hell.
    assert.equal(error.problems.length, 4);
    assert.match(error.message, /APP_KEY is required but not set/);
    assert.match(error.message, /PORT must be a number, got "eighty"/);
    assert.match(error.message, /NODE_ENV must be one of development, production, got "staging"/);
    assert.match(error.message, /DATABASE_URL must be a valid URL/);
  }
});

test("a description is included in the failure, so they know what to set", () => {
  try {
    defineEnv(
      { APP_KEY: envVar.string({ required: true, description: "generate one with `keel key:generate`" }) },
      { source: {} },
    );
    assert.fail("should have thrown");
  } catch (error) {
    assert.match((error as Error).message, /generate one with `keel key:generate`/);
  }
});

test("a custom validate() rejects with its own reason", () => {
  assert.throws(
    () =>
      defineEnv(
        {
          APP_KEY: envVar.string({
            required: true,
            validate: (value) => (value.length >= 32 ? true : "must be at least 32 characters"),
          }),
        },
        { source: { APP_KEY: "short" } },
      ),
    /APP_KEY: must be at least 32 characters/,
  );

  const env = defineEnv(
    {
      APP_KEY: envVar.string({
        required: true,
        validate: (value) => (value.length >= 4 ? true : "too short"),
      }),
    },
    { source: { APP_KEY: "long-enough" } },
  );
  assert.equal(env.APP_KEY, "long-enough");
});

test("the error message tells you what to do about it", () => {
  try {
    defineEnv({ APP_KEY: envVar.string({ required: true }) }, { source: {} });
    assert.fail("should have thrown");
  } catch (error) {
    assert.match((error as Error).message, /The environment is not valid/);
    assert.match((error as Error).message, /Set these in your \.env/);
  }
});

/* ------------------------------- inference -------------------------------- */

test("the value types are inferred from the rules", () => {
  const env = defineEnv(
    {
      APP_KEY: envVar.string({ required: true }),
      PORT: envVar.number({ default: 3000 }),
      DEBUG: envVar.boolean({ default: false }),
      NODE_ENV: envVar.enum(["development", "test", "production"], { default: "development" }),
      SENTRY_DSN: envVar.string(),
    },
    { source: { APP_KEY: "x" } },
  );

  // Compile-time assertions: if the inference regressed, this file wouldn't
  // typecheck. Note NODE_ENV is the union, not `string`.
  const key: string = env.APP_KEY;
  const port: number = env.PORT;
  const debug: boolean = env.DEBUG;
  const mode: "development" | "test" | "production" = env.NODE_ENV;
  const dsn: string | undefined = env.SENTRY_DSN;

  assert.deepEqual([key, port, debug, mode, dsn], ["x", 3000, false, "development", undefined]);
});

test("the returned object is frozen", () => {
  const env = defineEnv({ PORT: envVar.number({ default: 3000 }) }, { source: {} });
  assert.throws(() => {
    (env as { PORT: number }).PORT = 9999;
  }, TypeError);
});

/* --------------------------------- source --------------------------------- */

test("it reads process.env by default", () => {
  process.env.KEEL_TEST_VAR = "42";
  try {
    const env = defineEnv({ KEEL_TEST_VAR: envVar.number({ required: true }) });
    assert.equal(env.KEEL_TEST_VAR, 42);
  } finally {
    delete process.env.KEEL_TEST_VAR;
  }
});
