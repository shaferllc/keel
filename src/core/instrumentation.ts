/**
 * Framework instrumentation — the typed event stream that lets a package observe
 * the framework without patching it. Core seams (the query builder, the HTTP
 * kernel, the queue, the cache, …) call `instrument(event, payload)`; anything
 * that wants to watch subscribes with `listen()`. The mail layer already works
 * this way (`mail.sent`); this generalises it.
 *
 * These events are deliberately fire-and-forget: `instrument()` never blocks the
 * work it describes, and a listener that throws can't break a query or a
 * request. That's the difference between instrumentation and business logic.
 *
 * A **request id** ties a request to everything that happened inside it — the
 * queries it ran, the logs it wrote, the jobs it dispatched. The kernel opens a
 * request scope with `runRequest(id, …)`; anything emitted inside it can read
 * `currentRequestId()` to attribute itself. It flows through `await` chains via
 * `AsyncLocalStorage`, so nothing has to be threaded by hand.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { emit, hasApplication } from "./helpers.js";

/* ------------------------------ event payloads ---------------------------- */

/** A SQL statement that ran on a connection. */
export interface QueryEvent {
  sql: string;
  bindings: unknown[];
  /** Wall-clock time the statement took, in milliseconds. */
  durationMs: number;
  /** The registered connection name it ran on. */
  connection: string;
  /** "select" (row-returning) or "write" (insert/update/delete/DDL). */
  kind: "select" | "write";
  /** The request that ran it, if any. */
  requestId?: string;
}

/** A request that finished (or threw). */
export interface RequestEvent {
  id: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  /** Request headers, lower-cased (auth/cookies are redacted by watchers). */
  headers: Record<string, string>;
  ip?: string;
}

/** An error that reached the HTTP kernel. */
export interface ExceptionEvent {
  error: unknown;
  method?: string;
  path?: string;
  /** The status it rendered as. */
  status: number;
  requestId?: string;
}

/** A queued job at one point in its lifecycle. */
export interface JobEvent {
  job: string;
  payload?: unknown;
  /** Set on `job.processed` / `job.failed`. */
  durationMs?: number;
  /** Set on `job.failed`. */
  error?: unknown;
  requestId?: string;
}

/** A cache lookup. */
export interface CacheEvent {
  key: string;
  store: string;
  requestId?: string;
}

/** A notification that was sent. */
export interface NotificationEvent {
  notification: string;
  channels: string[];
  notifiable?: unknown;
  requestId?: string;
}

/** A scheduled task that ran. */
export interface ScheduleEvent {
  task: string;
  durationMs: number;
}

/**
 * Register the instrumentation events on the framework's typed event registry,
 * so `listen("db.query", (e) => …)` gets a fully-typed `e`. Any code that
 * augments `EventsList` merges with this — declaring your own events elsewhere
 * still works.
 */
declare module "./events.js" {
  interface EventsList {
    "db.query": QueryEvent;
    "request.handled": RequestEvent;
    "exception": ExceptionEvent;
    "job.processing": JobEvent;
    "job.processed": JobEvent;
    "job.failed": JobEvent;
    "cache.hit": CacheEvent;
    "cache.miss": CacheEvent;
    "notification.sent": NotificationEvent;
    "schedule.task.run": ScheduleEvent;
  }
}

/** The instrumentation event names, for iteration and toggling. */
export type InstrumentEvent =
  | "db.query"
  | "request.handled"
  | "exception"
  | "job.processing"
  | "job.processed"
  | "job.failed"
  | "cache.hit"
  | "cache.miss"
  | "notification.sent"
  | "schedule.task.run";

/* ------------------------------ request scope ----------------------------- */

const store = new AsyncLocalStorage<{ id: string }>();

/** A random id for a request/batch. 16 hex chars is plenty to be unique. */
export function newRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Run `fn` inside a request scope, so everything it does can be attributed. */
export function runRequest<T>(id: string, fn: () => T): T {
  return store.run({ id }, fn);
}

/** The id of the request currently in scope, if any. */
export function currentRequestId(): string | undefined {
  return store.getStore()?.id;
}

/* -------------------------------- emitting -------------------------------- */

/**
 * Emit an instrumentation event — fire-and-forget. Never throws, never blocks:
 * a broken watcher can't take down the request it was watching, and the work
 * being measured doesn't wait on the measurement. A no-op when there's no live
 * application (e.g. a unit test that never booted one).
 */
export function instrument<E extends InstrumentEvent>(
  event: E,
  payload: import("./events.js").EventsList[E],
): void {
  if (!hasApplication()) return;
  try {
    void Promise.resolve(emit(event, payload as never)).catch(() => {});
  } catch {
    // hasApplication() raced with teardown — instrumentation stays silent.
  }
}
