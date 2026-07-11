import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import {
  HttpException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ValidationException,
  createError,
} from "../src/core/exceptions.js";

test("createError mints a coded HttpException with %s formatting", () => {
  const InsufficientFunds = createError("E_FUNDS", "Balance too low: need %s", 402);
  const err = new InsufficientFunds("$40");
  assert.ok(err instanceof HttpException);
  assert.ok(err instanceof Error);
  assert.equal(err.status, 402);
  assert.equal(err.code, "E_FUNDS");
  assert.equal(err.message, "Balance too low: need $40");
  assert.equal(err.name, "E_FUNDS");
});

test("createError fills placeholders in order and leaves extras untouched", () => {
  const E = createError("E_X", "%s then %s", 400);
  assert.equal(new E("a", "b").message, "a then b");
  assert.equal(new E("a").message, "a then %s"); // missing arg → placeholder kept
  assert.equal(new E(1, 2).message, "1 then 2"); // numbers coerced
});

test("createError defaults to status 500", () => {
  const Boom = createError("E_BOOM", "boom");
  assert.equal(new Boom().status, 500);
});

test("built-in exceptions carry stable machine codes", () => {
  assert.equal(new NotFoundException().code, "E_NOT_FOUND");
  assert.equal(new UnauthorizedException().code, "E_UNAUTHORIZED");
  assert.equal(new ForbiddenException().code, "E_FORBIDDEN");
  assert.equal(new ValidationException({ email: ["required"] }).code, "E_VALIDATION");
});

async function build(configure: (r: Router) => void) {
  const app = new Application();
  await app.boot([], { discoverConfig: false, config: { app: {} } });
  configure(app.make(Router));
  return new HttpKernel(app).build();
}

test("a thrown coded error renders its code in the JSON body", async () => {
  const PaymentRequired = createError("E_PAYMENT", "Pay up: %s", 402);
  const hono = await build((r) => {
    r.get("/pay", () => {
      throw new PaymentRequired("$9");
    });
    r.get("/missing", () => {
      throw new NotFoundException();
    });
  });

  const pay = await hono.request("/pay");
  assert.equal(pay.status, 402);
  assert.deepEqual(await pay.json(), { error: "Pay up: $9", status: 402, code: "E_PAYMENT" });

  const missing = await hono.request("/missing");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "E_NOT_FOUND");
});
