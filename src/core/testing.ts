/**
 * A test client for Keel apps — inject requests without a live server and assert
 * on the response, the way Fastify's `inject()` does. Wraps the app's Hono
 * instance (which already does fetch-style request injection), adding verb
 * helpers with JSON bodies and fluent response assertions.
 *
 *   const client = await testClient(app);
 *   const res = await client.post("/users", { email: "a@b.com" });
 *   res.assertStatus(201).assertJson({ id: 1, email: "a@b.com" });
 *
 * Edge-safe — no server, no port; the same injection Keel's own suite uses.
 */

import { Application } from "./application.js";
import { HttpKernel } from "./http/kernel.js";

interface Requestable {
  request(input: string, init?: RequestInit): Promise<Response> | Response;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** A response captured by the test client — body pre-read, so reads are sync. */
export class TestResponse {
  constructor(
    readonly raw: Response,
    private readonly bodyText: string,
  ) {}

  get status(): number {
    return this.raw.status;
  }

  header(name: string): string | null {
    return this.raw.headers.get(name);
  }

  text(): string {
    return this.bodyText;
  }

  json<T = unknown>(): T {
    return JSON.parse(this.bodyText) as T;
  }

  /* ------------------------------ assertions ---------------------------- */

  assertStatus(expected: number): this {
    if (this.status !== expected) {
      throw new Error(`Expected status ${expected}, got ${this.status}. Body: ${this.bodyText}`);
    }
    return this;
  }

  /** Assert a 2xx status. */
  assertOk(): this {
    if (this.status < 200 || this.status >= 300) {
      throw new Error(`Expected a 2xx status, got ${this.status}. Body: ${this.bodyText}`);
    }
    return this;
  }

  /** Assert the JSON body deep-equals `expected`. */
  assertJson(expected: unknown): this {
    const actual = this.json();
    if (!deepEqual(actual, expected)) {
      throw new Error(
        `JSON body mismatch.\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
      );
    }
    return this;
  }

  assertText(expected: string): this {
    if (this.bodyText !== expected) {
      throw new Error(`Expected body "${expected}", got "${this.bodyText}"`);
    }
    return this;
  }

  assertHeader(name: string, value: string): this {
    const actual = this.header(name);
    if (actual !== value) {
      throw new Error(`Expected header ${name}: "${value}", got "${actual ?? "(absent)"}"`);
    }
    return this;
  }

  /** Assert a redirect (3xx) to `location`. */
  assertRedirect(location?: string): this {
    if (this.status < 300 || this.status >= 400) {
      throw new Error(`Expected a redirect (3xx), got ${this.status}`);
    }
    if (location !== undefined) this.assertHeader("location", location);
    return this;
  }
}

/** Injects requests into an app and returns `TestResponse`s. */
export class TestClient {
  constructor(private target: Requestable) {}

  async request(path: string, init: RequestInit = {}): Promise<TestResponse> {
    const res = await this.target.request(path, init);
    const text = await res.text();
    return new TestResponse(res, text);
  }

  get(path: string, init?: RequestInit): Promise<TestResponse> {
    return this.request(path, { ...init, method: "GET" });
  }

  delete(path: string, init?: RequestInit): Promise<TestResponse> {
    return this.request(path, { ...init, method: "DELETE" });
  }

  post(path: string, body?: unknown, init?: RequestInit): Promise<TestResponse> {
    return this.request(path, withJson("POST", body, init));
  }
  put(path: string, body?: unknown, init?: RequestInit): Promise<TestResponse> {
    return this.request(path, withJson("PUT", body, init));
  }
  patch(path: string, body?: unknown, init?: RequestInit): Promise<TestResponse> {
    return this.request(path, withJson("PATCH", body, init));
  }
}

function withJson(method: string, body: unknown, init: RequestInit = {}): RequestInit {
  if (body === undefined) return { ...init, method };
  return {
    ...init,
    method,
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(body),
  };
}

/**
 * Build a `TestClient` from an `Application`, an `HttpKernel`, or anything with a
 * `request()` (a built Hono instance). An `Application` is built through a fresh
 * `HttpKernel`; pass a kernel yourself if you need global middleware registered.
 */
export function testClient(target: Application | HttpKernel | Requestable): TestClient {
  if (target instanceof Application) return new TestClient(new HttpKernel(target).build());
  if (target instanceof HttpKernel) return new TestClient(target.build());
  return new TestClient(target);
}
