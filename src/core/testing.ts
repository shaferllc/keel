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
import { db, connection } from "./database.js";
import { hash } from "./crypto.js";
import { events, cache, hasApplication } from "./helpers.js";
import { restoreDisk } from "./storage.js";
import { restoreQueue, setQueue, SyncDriver } from "./queue.js";
import { restoreMail } from "./mail.js";
import { setLockStore, MemoryLockStore } from "./lock.js";

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

  /* --------------------------- status shorthands -------------------------- */

  assertCreated(): this {
    return this.assertStatus(201);
  }
  assertNoContent(): this {
    return this.assertStatus(204);
  }
  assertBadRequest(): this {
    return this.assertStatus(400);
  }
  assertUnauthorized(): this {
    return this.assertStatus(401);
  }
  assertForbidden(): this {
    return this.assertStatus(403);
  }
  assertNotFound(): this {
    return this.assertStatus(404);
  }
  /** 422 — the status a failed `validate()` returns. */
  assertUnprocessable(): this {
    return this.assertStatus(422);
  }
  assertServerError(): this {
    if (this.status < 500) throw new Error(`Expected a 5xx status, got ${this.status}.`);
    return this;
  }

  /* --------------------------------- body --------------------------------- */

  /**
   * Assert the JSON body *contains* `expected` — a subset match, so a test can
   * pin the fields it cares about without breaking every time an unrelated one
   * is added.
   *
   *   res.assertJsonContains({ user: { email: "a@b.com" } });
   */
  assertJsonContains(expected: unknown): this {
    const actual = this.json();
    if (!contains(actual, expected)) {
      throw new Error(
        `JSON body does not contain the expected subset.\n` +
          `  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
      );
    }
    return this;
  }

  /** Assert the body contains `text` anywhere. */
  assertSee(text: string): this {
    if (!this.bodyText.includes(text)) {
      throw new Error(`Expected the body to contain "${text}". Body: ${this.bodyText}`);
    }
    return this;
  }

  /** Assert the body does *not* contain `text`. */
  assertDontSee(text: string): this {
    if (this.bodyText.includes(text)) {
      throw new Error(`Expected the body not to contain "${text}". Body: ${this.bodyText}`);
    }
    return this;
  }

  /* ------------------------------ validation ------------------------------ */

  /**
   * Assert a 422 carrying an error on each named field. With no fields, it just
   * asserts that validation failed.
   *
   *   res.assertValidationErrors("email", "password");
   */
  assertValidationErrors(...fields: string[]): this {
    this.assertStatus(422);

    const errors = this.json<{ errors?: Record<string, string[]> }>().errors ?? {};
    for (const field of fields) {
      if (!errors[field]?.length) {
        throw new Error(
          `Expected a validation error on "${field}". Fields with errors: ${JSON.stringify(Object.keys(errors))}`,
        );
      }
    }
    return this;
  }

  /** Assert there is *no* validation error on `field`. */
  assertNoValidationError(field: string): this {
    const errors = this.json<{ errors?: Record<string, string[]> }>().errors;
    if (errors?.[field]?.length) {
      throw new Error(
        `Expected no validation error on "${field}", got: ${JSON.stringify(errors[field])}`,
      );
    }
    return this;
  }

  /* -------------------------- headers and cookies ------------------------- */

  assertHeaderMissing(name: string): this {
    const actual = this.header(name);
    if (actual !== null) throw new Error(`Expected no ${name} header, got "${actual}".`);
    return this;
  }

  /** The cookies this response set, by name. */
  cookies(): Record<string, string> {
    return cookiesOf(this.raw);
  }

  /** Assert the response set a cookie — with `value`, if you give one. */
  assertCookie(name: string, value?: string): this {
    const cookies = this.cookies();
    if (!(name in cookies)) {
      throw new Error(`Expected a "${name}" cookie. Got: ${JSON.stringify(Object.keys(cookies))}`);
    }
    if (value !== undefined && cookies[name] !== value) {
      throw new Error(`Expected cookie "${name}" to be "${value}", got "${cookies[name]}".`);
    }
    return this;
  }

  assertCookieMissing(name: string): this {
    if (name in this.cookies()) throw new Error(`Expected no "${name}" cookie, but one was set.`);
    return this;
  }

  /* --------------------------------- debug -------------------------------- */

  /** Print status, headers, and body — for when a test fails and you're stuck. */
  dump(): this {
    console.log(`\n--- ${this.status} ---`);
    console.log(Object.fromEntries(this.raw.headers.entries()));
    console.log(this.bodyText);
    return this;
  }
}

/** Defaults applied to every request a `TestClient` makes. */
interface ClientDefaults {
  headers: Record<string, string>;
  cookies: Record<string, string>;
}

/** Injects requests into an app and returns `TestResponse`s. */
export class TestClient {
  constructor(
    private target: Requestable,
    private defaults: ClientDefaults = { headers: {}, cookies: {} },
  ) {}

  /* ---------------------------- request building -------------------------- */

  /** A copy of this client with extra default headers. */
  withHeaders(headers: Record<string, string>): TestClient {
    return new TestClient(this.target, {
      ...this.defaults,
      headers: { ...this.defaults.headers, ...headers },
    });
  }

  withHeader(name: string, value: string): TestClient {
    return this.withHeaders({ [name]: value });
  }

  /** A copy of this client that sends these cookies. */
  withCookies(cookies: Record<string, string>): TestClient {
    return new TestClient(this.target, {
      ...this.defaults,
      cookies: { ...this.defaults.cookies, ...cookies },
    });
  }

  withCookie(name: string, value: string): TestClient {
    return this.withCookies({ [name]: value });
  }

  /** Send `Authorization: Bearer <token>` — the shorthand for an API test. */
  withToken(token: string): TestClient {
    return this.withHeader("authorization", `Bearer ${token}`);
  }

  /** Send HTTP basic credentials. */
  withBasicAuth(username: string, password: string): TestClient {
    return this.withHeader("authorization", `Basic ${btoa(`${username}:${password}`)}`);
  }

  /** Ask for JSON back — sets `Accept: application/json`. */
  acceptJson(): TestClient {
    return this.withHeader("accept", "application/json");
  }

  /** Merge the client's defaults into one request's init. */
  private init(init: RequestInit): RequestInit {
    const headers: Record<string, string> = {
      ...this.defaults.headers,
      ...((init.headers as Record<string, string>) ?? {}),
    };

    const cookies = Object.entries(this.defaults.cookies);
    if (cookies.length && !headers.cookie) {
      headers.cookie = cookies.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    }

    return { ...init, headers };
  }

  async request(path: string, init: RequestInit = {}): Promise<TestResponse> {
    const res = await this.target.request(path, this.init(init));
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

  /** POST a URL-encoded form, the way a browser would. */
  form(path: string, fields: Record<string, string | number | boolean>, init: RequestInit = {}): Promise<TestResponse> {
    const body = new URLSearchParams(
      Object.entries(fields).map(([k, v]) => [k, String(v)]),
    ).toString();

    return this.request(path, {
      ...init,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(init.headers as object) },
      body,
    });
  }

  /** POST a multipart form — for file uploads. */
  multipart(
    path: string,
    fields: Record<string, string | Blob>,
    init: RequestInit = {},
  ): Promise<TestResponse> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    // No content-type header: the runtime sets it, with the multipart boundary.
    return this.request(path, { ...init, method: "POST", body: form });
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

/* ==========================================================================
 * Below: the rest of the testing toolkit — a richer request builder, more
 * response assertions, database assertions, state reset between tests, time
 * control, spies, and console-command testing.
 * ========================================================================== */

/* ---------------------------- deep subset match --------------------------- */

/** Whether `actual` contains everything in `expected` (recursively). */
function contains(actual: unknown, expected: unknown): boolean {
  if (deepEqual(actual, expected)) return true;
  if (typeof expected !== "object" || expected === null) return false;
  if (typeof actual !== "object" || actual === null) return false;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    // Every expected element must appear somewhere in actual.
    return expected.every((want) => actual.some((got) => contains(got, want)));
  }

  return Object.entries(expected as Record<string, unknown>).every(([key, want]) =>
    contains((actual as Record<string, unknown>)[key], want),
  );
}

/** Parse `Set-Cookie` headers into a name -> value map. */
function cookiesOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  // getSetCookie() is the standard way to read repeated Set-Cookie headers.
  const raw =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean) as string[];

  for (const line of raw) {
    const [pair] = line.split(";");
    const index = (pair ?? "").indexOf("=");
    if (index > 0) out[pair!.slice(0, index).trim()] = decodeURIComponent(pair!.slice(index + 1).trim());
  }
  return out;
}

/* ------------------------------ state reset ------------------------------- */

/**
 * Put the framework's global state back the way it was, so one test can't leak
 * into the next. Call it in an `afterEach`.
 *
 *   afterEach(() => resetState());
 *
 * It restores every fake (disk, queue, mail, hash, time), drops event listeners,
 * empties the cache, and gives you a fresh lock store. It does **not** touch the
 * database — see `refreshDatabase()`.
 */
export function resetState(): void {
  restoreDisk();
  restoreQueue();
  restoreMail();
  restoreTime();
  hash.restore();
  setQueue(new SyncDriver());
  setLockStore(new MemoryLockStore());

  // These live on the application, so they only exist if one was booted.
  if (hasApplication()) {
    events().clearAll();
    void cache().flush();
  }
}

/* ------------------------------ time control ------------------------------ */

const RealDate = Date;
let frozenAt: number | undefined;

/** Whether time is currently frozen. */
export function timeIsFrozen(): boolean {
  return frozenAt !== undefined;
}

function installFakeDate(): void {
  if (globalThis.Date !== RealDate) return;

  class FakeDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(frozenAt ?? RealDate.now());
      else super(...(args as ConstructorParameters<typeof RealDate>));
    }
    static override now(): number {
      return frozenAt ?? RealDate.now();
    }
  }

  globalThis.Date = FakeDate as unknown as DateConstructor;
}

/**
 * Freeze the clock, so anything that reads the time sees the same instant —
 * which is how you test a token that expires in an hour without waiting an hour.
 *
 *   freezeTime("2026-07-11T12:00:00Z");
 *   timeTravel(3600_000);            // an hour later
 *   restoreTime();
 *
 * Mocks `Date` and `Date.now()`. It does **not** mock timers: a `setTimeout` still
 * fires on the real clock.
 */
export function freezeTime(at: Date | number | string = RealDate.now()): number {
  frozenAt = at instanceof RealDate ? at.getTime() : new RealDate(at as string | number).getTime();
  installFakeDate();
  return frozenAt;
}

/** Move the frozen clock forward (or back, with a negative value) by milliseconds. */
export function timeTravel(ms: number): number {
  if (frozenAt === undefined) freezeTime();
  frozenAt = frozenAt! + ms;
  return frozenAt;
}

/** Hand the real clock back. */
export function restoreTime(): void {
  frozenAt = undefined;
  globalThis.Date = RealDate;
}

/* --------------------------- database assertions -------------------------- */

/** Rows in `table` matching every column in `where`. */
async function matching(table: string, where: Record<string, unknown>): Promise<unknown[]> {
  let query = db(table);
  for (const [column, value] of Object.entries(where)) query = query.where(column, value);
  return query.get();
}

/** Assert at least one row in `table` matches `where` (an exact `count` if given). */
export async function assertDatabaseHas(
  table: string,
  where: Record<string, unknown>,
  count?: number,
): Promise<void> {
  const rows = await matching(table, where);

  if (count !== undefined) {
    if (rows.length !== count) {
      throw new Error(
        `Expected ${count} row(s) in "${table}" matching ${JSON.stringify(where)}, found ${rows.length}.`,
      );
    }
    return;
  }

  if (!rows.length) {
    const total = (await db(table).get()).length;
    throw new Error(
      `Expected a row in "${table}" matching ${JSON.stringify(where)}, but found none. ` +
        `The table has ${total} row(s).`,
    );
  }
}

/** Assert no row in `table` matches `where`. */
export async function assertDatabaseMissing(
  table: string,
  where: Record<string, unknown>,
): Promise<void> {
  const rows = await matching(table, where);
  if (rows.length) {
    throw new Error(
      `Expected no row in "${table}" matching ${JSON.stringify(where)}, but found ${rows.length}.`,
    );
  }
}

/** Assert `table` holds exactly `count` rows. */
export async function assertDatabaseCount(table: string, count: number): Promise<void> {
  const rows = await db(table).get();
  if (rows.length !== count) {
    throw new Error(`Expected "${table}" to hold ${count} row(s), found ${rows.length}.`);
  }
}

/** Assert `table` is empty. */
export function assertDatabaseEmpty(table: string): Promise<void> {
  return assertDatabaseCount(table, 0);
}

/**
 * Empty tables between tests. Order matters when foreign keys do — pass children
 * before parents.
 *
 *   afterEach(() => truncate("comments", "posts", "users"));
 *
 * This deletes rows; it doesn't roll back a transaction, so it works on every
 * driver (D1, Postgres, libSQL) rather than only the ones with savepoints.
 */
export async function truncate(...tables: string[]): Promise<void> {
  for (const table of tables) await connection().write(`DELETE FROM ${table}`);
}

/* ---------------------------------- spies --------------------------------- */

/** A recording stand-in for a function. */
export interface Spy<A extends unknown[] = unknown[], R = unknown> {
  (...args: A): R;
  /** The arguments of every call, in order. */
  readonly calls: A[];
  readonly callCount: number;
  /** Whether it was called at all. */
  readonly called: boolean;
  /** Whether any call had exactly these arguments. */
  calledWith(...args: A): boolean;
  /** Make it return something (or something new). */
  returns(value: R): Spy<A, R>;
  reset(): void;
}

/**
 * A function that records how it was called — the smallest useful test double.
 *
 *   const send = spy<[string], void>();
 *   notify(send);
 *   assert.equal(send.callCount, 1);
 *   assert.ok(send.calledWith("hello"));
 */
export function spy<A extends unknown[] = unknown[], R = unknown>(
  implementation?: (...args: A) => R,
): Spy<A, R> {
  const calls: A[] = [];
  let impl = implementation;

  const fn = ((...args: A): R => {
    calls.push(args);
    return impl ? impl(...args) : (undefined as R);
  }) as Spy<A, R>;

  Object.defineProperties(fn, {
    calls: { get: () => calls },
    callCount: { get: () => calls.length },
    called: { get: () => calls.length > 0 },
  });

  fn.calledWith = (...args: A) => calls.some((call) => deepEqual(call, args));
  fn.returns = (value: R) => {
    impl = () => value;
    return fn;
  };
  fn.reset = () => {
    calls.length = 0;
  };

  return fn;
}

/**
 * Replace a method on an object with a spy, and hand back a `restore()`.
 *
 *   const charge = spyOn(stripe, "charge").returns(Promise.resolve(receipt));
 *   …
 *   restoreSpies();
 */
const spied: Array<() => void> = [];

export function spyOn<T extends object, K extends keyof T>(
  target: T,
  method: K,
): Spy<unknown[], unknown> {
  const original = target[method];
  const replacement = spy((...args: unknown[]) =>
    typeof original === "function" ? (original as (...a: unknown[]) => unknown).apply(target, args) : undefined,
  );

  target[method] = replacement as unknown as T[K];
  spied.push(() => {
    target[method] = original;
  });

  return replacement;
}

/** Undo every `spyOn()`. */
export function restoreSpies(): void {
  for (const restore of spied.splice(0)) restore();
}

/* ------------------------------ console tests ----------------------------- */

/** What a command did: its output, its error output, and its exit code. */
export class CommandResult {
  constructor(
    readonly stdout: string[],
    readonly stderr: string[],
    readonly exitCode: number,
  ) {}

  /** Everything written to stdout, joined. */
  output(): string {
    return this.stdout.join("\n");
  }

  assertExitCode(expected: number): this {
    if (this.exitCode !== expected) {
      throw new Error(
        `Expected exit code ${expected}, got ${this.exitCode}.\n${this.output()}\n${this.stderr.join("\n")}`,
      );
    }
    return this;
  }

  /** Exit code 0. */
  assertSucceeded(): this {
    return this.assertExitCode(0);
  }

  /** A non-zero exit code. */
  assertFailed(): this {
    if (this.exitCode === 0) {
      throw new Error(`Expected the command to fail, but it exited 0.\n${this.output()}`);
    }
    return this;
  }

  /** Assert a line of output contains `text`. */
  assertOutputContains(text: string): this {
    if (!this.output().includes(text)) {
      throw new Error(`Expected the output to contain "${text}".\nOutput:\n${this.output()}`);
    }
    return this;
  }

  assertOutputMatches(pattern: RegExp): this {
    if (!pattern.test(this.output())) {
      throw new Error(`Expected the output to match ${pattern}.\nOutput:\n${this.output()}`);
    }
    return this;
  }

  assertErrorContains(text: string): this {
    const stderr = this.stderr.join("\n");
    if (!stderr.includes(text)) {
      throw new Error(`Expected stderr to contain "${text}".\nstderr:\n${stderr}`);
    }
    return this;
  }
}

/**
 * Run a console command in-process and capture what it printed and the exit code
 * it set — no subprocess, so it's fast and you can assert on it.
 *
 * You pass the command in, because the console entry point belongs to your app
 * (it's the thing that knows how to build your application), not to the core:
 *
 *   import { run } from "@shaferllc/keel/cli";
 *   import { createApplication } from "../bootstrap/app.js";
 *
 *   const result = await runCommand(() => run(["node", "keel", "routes"], { createApplication }));
 *   result.assertSucceeded().assertOutputContains("GET  /users");
 *
 * `console.log`/`warn` are captured as stdout, `console.error` as stderr, and
 * `process.exitCode` is read and then restored.
 */
export async function runCommand(command: () => unknown | Promise<unknown>): Promise<CommandResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const real = { log: console.log, error: console.error, warn: console.warn };
  const previousExit = process.exitCode;
  process.exitCode = 0;

  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(" "));

  try {
    await command();
  } catch (error) {
    // A command that throws is a command that failed — record it, don't blow up
    // the test with an unrelated stack.
    stderr.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    Object.assign(console, real);
  }

  const exitCode = Number(process.exitCode ?? 0);
  process.exitCode = previousExit;

  return new CommandResult(stdout, stderr, exitCode);
}
