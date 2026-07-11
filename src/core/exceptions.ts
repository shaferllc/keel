/**
 * HTTP exceptions. Throw one of these anywhere in a handler, middleware, or
 * service and the HTTP kernel turns it into the right response — a status code
 * with a clean body (JSON or HTML), or a readable error page in debug mode.
 */

export const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  411: "Length Required",
  419: "Page Expired",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

/**
 * A semantic HTTP error carrying a status code and optional headers.
 *
 * Subclasses may add:
 * - a `code` (e.g. "E_UNAUTHORIZED") — included in the JSON error body;
 * - a `handle(c)` method — renders the exception itself (self-handling);
 * - a `report()` method — called for logging/reporting before rendering.
 */
export class HttpException extends Error {
  readonly status: number;
  readonly headers?: Record<string, string>;
  /** A machine-readable error code, e.g. "E_VALIDATION". */
  code?: string;
  /** Structured context attached to the error; surfaced in the JSON body as `data`. */
  data?: unknown;

  constructor(status: number, message?: string, headers?: Record<string, string>, data?: unknown) {
    super(message ?? STATUS_TEXT[status] ?? "Error");
    this.name = "HttpException";
    this.status = status;
    this.headers = headers;
    this.data = data;
  }

  /**
   * The error as a plain object, matching the JSON body the HTTP kernel renders:
   * `{ error, status }` plus `code` and `data` when present. Subclasses that add
   * fields (e.g. `ValidationException.errors`) override this to include them.
   */
  toJSON(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.message, status: this.status };
    if (this.code) body.code = this.code;
    if (this.data !== undefined) body.data = this.data;
    return body;
  }
}

/*
 * The standard HTTP error family. Each carries a fixed status and a stable
 * `code`, and takes an optional `data` bag that lands in the JSON body. Throw
 * any of them from a handler, middleware, or service to short-circuit with the
 * right status. Ordered by status code.
 */

/** 400 — the request was malformed or failed validation. */
export class BadRequestException extends HttpException {
  constructor(message = "Bad Request", data?: unknown) {
    super(400, message, undefined, data);
    this.name = "BadRequestException";
    this.code = "E_BAD_REQUEST";
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = "Unauthorized", data?: unknown) {
    super(401, message, undefined, data);
    this.name = "UnauthorizedException";
    this.code = "E_UNAUTHORIZED";
  }
}

/** 402 — payment is required to access the resource. */
export class PaymentRequiredException extends HttpException {
  constructor(message = "Payment Required", data?: unknown) {
    super(402, message, undefined, data);
    this.name = "PaymentRequiredException";
    this.code = "E_PAYMENT_REQUIRED";
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = "Forbidden", data?: unknown) {
    super(403, message, undefined, data);
    this.name = "ForbiddenException";
    this.code = "E_FORBIDDEN";
  }
}

export class NotFoundException extends HttpException {
  constructor(message = "Not Found", data?: unknown) {
    super(404, message, undefined, data);
    this.name = "NotFoundException";
    this.code = "E_NOT_FOUND";
  }
}

/** 405 — the HTTP method isn't allowed for this resource. */
export class MethodNotAllowedException extends HttpException {
  constructor(message = "Method Not Allowed", data?: unknown) {
    super(405, message, undefined, data);
    this.name = "MethodNotAllowedException";
    this.code = "E_METHOD_NOT_ALLOWED";
  }
}

/** 406 — no representation matches the request's `Accept` header. */
export class NotAcceptableException extends HttpException {
  constructor(message = "Not Acceptable", data?: unknown) {
    super(406, message, undefined, data);
    this.name = "NotAcceptableException";
    this.code = "E_NOT_ACCEPTABLE";
  }
}

/** 408 — the client took too long to send the request. */
export class RequestTimeoutException extends HttpException {
  constructor(message = "Request Timeout", data?: unknown) {
    super(408, message, undefined, data);
    this.name = "RequestTimeoutException";
    this.code = "E_REQUEST_TIMEOUT";
  }
}

/** 409 — the request conflicts with the current state (e.g. a duplicate). */
export class ConflictException extends HttpException {
  constructor(message = "Conflict", data?: unknown) {
    super(409, message, undefined, data);
    this.name = "ConflictException";
    this.code = "E_CONFLICT";
  }
}

/** 411 — a `Content-Length` header is required and was missing. */
export class LengthRequiredException extends HttpException {
  constructor(message = "Length Required", data?: unknown) {
    super(411, message, undefined, data);
    this.name = "LengthRequiredException";
    this.code = "E_LENGTH_REQUIRED";
  }
}

/** 422 with per-field messages. Pairs with the validation layer. */
export class ValidationException extends HttpException {
  readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>, message = "The given data was invalid.") {
    super(422, message);
    this.name = "ValidationException";
    this.code = "E_VALIDATION";
    this.errors = errors;
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), errors: this.errors };
  }
}

/** 429 — the client has sent too many requests in a given window. */
export class TooManyRequestsException extends HttpException {
  constructor(message = "Too Many Requests", data?: unknown) {
    super(429, message, undefined, data);
    this.name = "TooManyRequestsException";
    this.code = "E_TOO_MANY_REQUESTS";
  }
}

/** 500 — a catch-all server error you want to raise deliberately. */
export class ServerErrorException extends HttpException {
  constructor(message = "Internal Server Error", data?: unknown) {
    super(500, message, undefined, data);
    this.name = "ServerErrorException";
    this.code = "E_SERVER_ERROR";
  }
}

/** 501 — the requested functionality isn't implemented. */
export class NotImplementedException extends HttpException {
  constructor(message = "Not Implemented", data?: unknown) {
    super(501, message, undefined, data);
    this.name = "NotImplementedException";
    this.code = "E_NOT_IMPLEMENTED";
  }
}

/** 502 — an upstream server returned an invalid response. */
export class BadGatewayException extends HttpException {
  constructor(message = "Bad Gateway", data?: unknown) {
    super(502, message, undefined, data);
    this.name = "BadGatewayException";
    this.code = "E_BAD_GATEWAY";
  }
}

/** 503 — the service is temporarily unavailable (down, overloaded). */
export class ServiceUnavailableException extends HttpException {
  constructor(message = "Service Unavailable", data?: unknown) {
    super(503, message, undefined, data);
    this.name = "ServiceUnavailableException";
    this.code = "E_SERVICE_UNAVAILABLE";
  }
}

/**
 * Mint a reusable, coded `HttpException` subclass — the ergonomic way to define
 * app-specific errors with a stable, machine-readable `code`. Inspired by
 * `@fastify/error`. The `message` may carry `%s` placeholders, filled in order
 * from the constructor arguments.
 *
 *   const InsufficientFunds = createError("E_FUNDS", "Balance too low: need %s", 402);
 *   throw new InsufficientFunds("$40");
 *   // → 402  { error: "Balance too low: need $40", status: 402, code: "E_FUNDS" }
 *
 * The returned class extends `HttpException`, so it renders through the same
 * path — `code` lands in the JSON body — and passes `instanceof HttpException`.
 */
export function createError(
  code: string,
  message: string,
  status = 500,
): new (...args: (string | number)[]) => HttpException {
  return class extends HttpException {
    constructor(...args: (string | number)[]) {
      super(status, formatMessage(message, args));
      this.name = code;
      this.code = code;
    }
  };
}

/** printf-lite: replace each `%s` with the next argument, in order. */
function formatMessage(template: string, args: (string | number)[]): string {
  let index = 0;
  return template.replace(/%s/g, () => (index < args.length ? String(args[index++]) : "%s"));
}
