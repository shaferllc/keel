import { test } from "node:test";
import assert from "node:assert/strict";

import { Application } from "../src/core/application.js";
import { Router } from "../src/core/http/router.js";
import { HttpKernel } from "../src/core/http/kernel.js";
import {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  PaymentRequiredException,
  ForbiddenException,
  NotFoundException,
  MethodNotAllowedException,
  NotAcceptableException,
  RequestTimeoutException,
  ConflictException,
  LengthRequiredException,
  ValidationException,
  TooManyRequestsException,
  ServerErrorException,
  NotImplementedException,
  BadGatewayException,
  ServiceUnavailableException,
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

test("the full HTTP error family maps names to statuses and codes", () => {
  const cases: [HttpException, number, string, string][] = [
    [new BadRequestException(), 400, "BadRequestException", "E_BAD_REQUEST"],
    [new UnauthorizedException(), 401, "UnauthorizedException", "E_UNAUTHORIZED"],
    [new PaymentRequiredException(), 402, "PaymentRequiredException", "E_PAYMENT_REQUIRED"],
    [new ForbiddenException(), 403, "ForbiddenException", "E_FORBIDDEN"],
    [new NotFoundException(), 404, "NotFoundException", "E_NOT_FOUND"],
    [new MethodNotAllowedException(), 405, "MethodNotAllowedException", "E_METHOD_NOT_ALLOWED"],
    [new NotAcceptableException(), 406, "NotAcceptableException", "E_NOT_ACCEPTABLE"],
    [new RequestTimeoutException(), 408, "RequestTimeoutException", "E_REQUEST_TIMEOUT"],
    [new ConflictException(), 409, "ConflictException", "E_CONFLICT"],
    [new LengthRequiredException(), 411, "LengthRequiredException", "E_LENGTH_REQUIRED"],
    [new TooManyRequestsException(), 429, "TooManyRequestsException", "E_TOO_MANY_REQUESTS"],
    [new ServerErrorException(), 500, "ServerErrorException", "E_SERVER_ERROR"],
    [new NotImplementedException(), 501, "NotImplementedException", "E_NOT_IMPLEMENTED"],
    [new BadGatewayException(), 502, "BadGatewayException", "E_BAD_GATEWAY"],
    [new ServiceUnavailableException(), 503, "ServiceUnavailableException", "E_SERVICE_UNAVAILABLE"],
  ];
  for (const [err, status, name, code] of cases) {
    assert.ok(err instanceof HttpException, `${name} extends HttpException`);
    assert.equal(err.status, status, `${name} status`);
    assert.equal(err.name, name);
    assert.equal(err.code, code, `${name} code`);
  }
});

test("an exception's data bag surfaces via toJSON and in the JSON body", async () => {
  const err = new ConflictException("Email taken", { email: "a@b.com" });
  assert.deepEqual(err.toJSON(), {
    error: "Email taken",
    status: 409,
    code: "E_CONFLICT",
    data: { email: "a@b.com" },
  });

  const hono = await build((r) => {
    r.post("/signup", () => {
      throw new ConflictException("Email taken", { email: "a@b.com" });
    });
  });
  const res = await hono.request("/signup", { method: "POST" });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), {
    error: "Email taken",
    status: 409,
    code: "E_CONFLICT",
    data: { email: "a@b.com" },
  });
});

test("ValidationException.toJSON includes per-field errors", () => {
  const err = new ValidationException({ email: ["required"] });
  assert.deepEqual(err.toJSON(), {
    error: "The given data was invalid.",
    status: 422,
    code: "E_VALIDATION",
    errors: { email: ["required"] },
  });
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
