// Type-check harness for docs/errors.md. Every type-checkable snippet in the
// reference is exercised here against the real exports, so a renamed field or a
// wrong constructor signature fails `npm run typecheck:docs`. Compile-only —
// never executed.
import {
  HttpException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  ValidationException,
  createError,
  STATUS_TEXT,
  HttpKernel,
  Application,
} from "@shaferllc/keel/core";
import type { Context } from "hono";

// createError --------------------------------------------------------------
export const InsufficientFunds = createError("E_FUNDS", "Balance too low: need %s", 402);
export const TenantSuspended = createError("E_TENANT_SUSPENDED", "Tenant %s is suspended.", 403);
export const RateExceeded = createError("E_RATE", "Slow down.", 429);

export function throwCoded(): never {
  const err = new InsufficientFunds("$40");
  const isHttp: boolean = err instanceof HttpException;
  void isHttp;
  throw err;
}

// HTTP exceptions ----------------------------------------------------------
export function httpExceptions(): never {
  throw new NotFoundException("Widget not found"); // 404
}

export function moreThrows() {
  const throwers: Array<() => never> = [
    () => {
      throw new UnauthorizedException();
    },
    () => {
      throw new ForbiddenException();
    },
    () => {
      throw new HttpException(429, "Slow down");
    },
    () => {
      throw new HttpException(503, "Down for maintenance", { "Retry-After": "120" });
    },
    () => {
      throw new HttpException(429, "Slow down", { "Retry-After": "30" });
    },
    () => {
      throw new HttpException(409, "That email is taken");
    },
    () => {
      throw new HttpException(429); // message defaults to "Too Many Requests"
    },
  ];
  return throwers;
}

// Validation ---------------------------------------------------------------
export function validation(): never {
  throw new ValidationException({
    email: ["The email is invalid."],
    password: ["Too short.", "Must contain a number."],
  });
}

export function readsErrors() {
  const ex = new ValidationException({ email: ["nope"] });
  const fields: Record<string, string[]> = ex.errors;
  return fields;
}

// Fields the kernel reads --------------------------------------------------
export function fields() {
  const ex = new HttpException(503, "Down", { "Retry-After": "120" });
  const status: number = ex.status;
  const headers: Record<string, string> | undefined = ex.headers;
  ex.code = "E_DOWN";
  const code: string | undefined = ex.code;
  return { status, headers, code };
}

// Custom exception with self-render / self-report --------------------------
declare const metrics: { increment(name: string): void };

export class PaymentRequiredException extends HttpException {
  code = "E_PAYMENT_REQUIRED";

  constructor() {
    super(402, "Payment is required to continue.");
  }

  handle(c: Context) {
    // hono's `json` wants a status-code literal; the exception's numeric
    // `status` is asserted to it (402 here).
    return c.json({ error: this.message, code: this.code, upgrade: "/billing" }, this.status as 402);
  }

  report() {
    metrics.increment("payment_required");
  }
}

// Custom error handler on the kernel ---------------------------------------
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.onError((_err, c) => c.json({ oops: true }, 500));
  }
}

// STATUS_TEXT --------------------------------------------------------------
export function statusText() {
  const notFound: string | undefined = STATUS_TEXT[404]; // "Not Found"
  const expired: string | undefined = STATUS_TEXT[419]; // "Page Expired"
  const fallback: string = STATUS_TEXT[418] ?? "Error"; // not in the map
  return { notFound, expired, fallback };
}
