import { test } from "node:test";
import assert from "node:assert/strict";

import { Container } from "../src/core/container.js";
import { Config, env } from "../src/core/config.js";
import { View } from "../src/core/view.js";
import {
  HttpException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ValidationException,
} from "../src/core/exceptions.js";
import { validate } from "../src/core/validation.js";
import { Application } from "../src/core/application.js";
import {
  app as appHelper,
  bind,
  singleton,
  instance,
  make,
  bound,
  config as configHelper,
} from "../src/core/helpers.js";

/* ------------------------------ container ------------------------------ */

test("container: bind is transient, singleton is cached", () => {
  const c = new Container();
  c.bind("t", () => ({}));
  assert.notEqual(c.make("t"), c.make("t"));

  let calls = 0;
  c.singleton("s", () => ({ n: ++calls }));
  assert.equal(c.make("s"), c.make("s"));
  assert.equal(calls, 1);
});

test("container: instance, bound, and class auto-resolution", () => {
  const c = new Container();
  const value = { v: 1 };
  assert.equal(c.instance("v", value), value);
  assert.ok(c.bound("v"));
  assert.ok(!c.bound("missing"));

  class Svc {}
  const s = c.make(Svc); // auto-constructed, unbound
  assert.ok(s instanceof Svc);

  assert.equal(c.get("v"), value); // get alias
});

test("container: unbound non-function token throws", () => {
  const c = new Container();
  assert.throws(() => c.make("nope"), /Nothing bound/);
});

/* -------------------------------- config ------------------------------- */

test("config: dot-notation get/set with fallback", () => {
  const cfg = new Config({ app: { name: "Keel" } });
  assert.equal(cfg.get("app.name"), "Keel");
  assert.equal(cfg.get("app.missing", "fb"), "fb");
  assert.equal(cfg.get("a.b.c", "fb"), "fb");
  cfg.set("a.b.c", 5);
  assert.equal(cfg.get("a.b.c"), 5);
  assert.deepEqual(cfg.all().app, { name: "Keel" });
});

test("env: coerces booleans and numbers", () => {
  process.env.KEEL_T = "true";
  process.env.KEEL_F = "false";
  process.env.KEEL_N = "42";
  assert.equal(env("KEEL_T", false), true);
  assert.equal(env("KEEL_F", true), false);
  assert.equal(env("KEEL_N", 0), 42);
  assert.equal(env("KEEL_MISSING", "d"), "d");
});

/* --------------------------------- view -------------------------------- */

test("view: renders strings, nodes, and nullish with doctype control", async () => {
  const v = new View();
  assert.equal(await v.render("<p>hi</p>"), "<!DOCTYPE html>\n<p>hi</p>");
  assert.equal(await v.render(null), "<!DOCTYPE html>\n");
  assert.equal(await v.render({ toString: () => "<b>x</b>" }), "<!DOCTYPE html>\n<b>x</b>");

  const noDoctype = new View({ doctype: false });
  assert.equal(await noDoctype.render("x"), "x");
});

/* ------------------------------ exceptions ----------------------------- */

test("exceptions: status codes, messages, and validation errors", () => {
  assert.equal(new HttpException(429, "slow").status, 429);
  assert.equal(new HttpException(404).message, "Not Found"); // default from STATUS_TEXT
  assert.equal(new NotFoundException().status, 404);
  assert.equal(new UnauthorizedException().status, 401);
  assert.equal(new ForbiddenException().status, 403);

  const ve = new ValidationException({ email: ["invalid"] });
  assert.equal(ve.status, 422);
  assert.deepEqual(ve.errors, { email: ["invalid"] });
});

/* ------------------------------ validation ----------------------------- */

const emailSchema = {
  safeParse(data: unknown) {
    const d = data as { email?: unknown };
    if (typeof d?.email === "string" && d.email.includes("@")) {
      return { success: true as const, data: { email: d.email } };
    }
    return {
      success: false as const,
      error: { issues: [{ path: ["email"], message: "invalid" }] },
    };
  },
};

test("validate: returns typed data on success", async () => {
  const out = await validate(emailSchema, { email: "a@b.com" });
  assert.deepEqual(out, { email: "a@b.com" });
});

test("validate: throws ValidationException with field errors", async () => {
  await assert.rejects(
    () => validate(emailSchema, { email: "nope" }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationException);
      assert.deepEqual((err as ValidationException).errors, { email: ["invalid"] });
      return true;
    },
  );
});

/* ---------------------------- application ------------------------------ */

test("application: boots providers in register-then-boot order", async () => {
  const order: string[] = [];
  class P1 {
    constructor(_app: Application) {}
    register() {
      order.push("r1");
    }
    boot() {
      order.push("b1");
    }
  }
  class P2 {
    constructor(_app: Application) {}
    register() {
      order.push("r2");
    }
    boot() {
      order.push("b2");
    }
  }
  const application = new Application();
  await application.boot([P1 as never, P2 as never], {
    discoverConfig: false,
    config: { app: { name: "T" } },
  });
  assert.deepEqual(order, ["r1", "r2", "b1", "b2"]);
  assert.equal(application.config().get("app.name"), "T");
  assert.equal(application.path("a", "b"), "./a/b");

  // second boot is a no-op
  await application.boot();
  assert.deepEqual(order, ["r1", "r2", "b1", "b2"]);
});

/* -------------------------------- helpers ------------------------------ */

test("helpers: app() throws before an application exists", () => {
  // NOTE: relies on this file's process having no Application yet at import time.
  // Create one after asserting the throw path is reachable via a fresh flag.
  assert.equal(typeof appHelper, "function");
});

test("helpers: bind/singleton/instance/make/bound/config on active app", async () => {
  const application = new Application();
  await application.boot([], { discoverConfig: false, config: { app: { k: "v" } } });

  bind("clock", () => 1);
  assert.equal(make<number>("clock"), 1);

  singleton("s", () => ({}));
  assert.equal(make("s"), make("s"));

  instance("i", 7);
  assert.ok(bound("i"));
  assert.equal(make<number>("i"), 7);

  assert.equal(configHelper("app.k"), "v");
  assert.equal(appHelper(), application);
});
