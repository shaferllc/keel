/**
 * HTTP exceptions. Throw one of these anywhere in a handler, middleware, or
 * service and the HTTP kernel turns it into the right response — a status code
 * with a clean body (JSON or HTML), or a readable error page in debug mode.
 */

export const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  419: "Page Expired",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
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

  constructor(status: number, message?: string, headers?: Record<string, string>) {
    super(message ?? STATUS_TEXT[status] ?? "Error");
    this.name = "HttpException";
    this.status = status;
    this.headers = headers;
  }
}

export class NotFoundException extends HttpException {
  constructor(message = "Not Found") {
    super(404, message);
    this.name = "NotFoundException";
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = "Unauthorized") {
    super(401, message);
    this.name = "UnauthorizedException";
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = "Forbidden") {
    super(403, message);
    this.name = "ForbiddenException";
  }
}

/** 422 with per-field messages. Pairs with a future validation layer. */
export class ValidationException extends HttpException {
  readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>, message = "The given data was invalid.") {
    super(422, message);
    this.name = "ValidationException";
    this.errors = errors;
  }
}
