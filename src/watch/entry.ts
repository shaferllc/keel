/**
 * A recorded entry — one thing that happened in the app: a request, a query, an
 * exception, a log line. Every watcher produces these; the store persists them;
 * the dashboard reads them back.
 *
 * Two ids give the UI its shape. `batchId` ties an entry to the request (or job,
 * or scheduled run) it happened inside, so the dashboard can show a request and
 * every query, log, and exception it produced. `familyHash` groups entries that
 * are "the same" — the same SQL shape, the same exception — so recurring things
 * can be counted and collapsed.
 */

export type EntryType =
  | "request"
  | "query"
  | "exception"
  | "log"
  | "mail"
  | "job"
  | "notification"
  | "cache"
  | "event"
  | "schedule";

/** Every entry type, in the order the dashboard shows its tabs. */
export const ENTRY_TYPES: EntryType[] = [
  "request",
  "query",
  "exception",
  "log",
  "mail",
  "job",
  "notification",
  "cache",
  "event",
  "schedule",
];

export interface Entry {
  /** Unique id (32 hex). */
  uuid: string;
  /** The request/job/run this happened inside; groups related entries. */
  batchId: string;
  type: EntryType;
  /** Groups "the same" entry — same SQL shape, same exception class+message. */
  familyHash?: string;
  /** The type-specific detail the dashboard renders. Always JSON-safe. */
  content: Record<string, unknown>;
  /** Free-form labels for filtering: `status:500`, `slow`, `connection:default`. */
  tags: string[];
  /** Epoch milliseconds. */
  createdAt: number;
}

/** A filter over stored entries, for the list endpoint. */
export interface EntryFilter {
  type?: EntryType;
  tag?: string;
  batchId?: string;
  /** Keyset pagination: only entries created strictly before this timestamp. */
  before?: number;
  limit?: number;
}

/* --------------------------------- ids ------------------------------------ */

/** A 32-hex id for an entry. */
export function newUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A short, stable hash (8 hex) of a string — for `familyHash`. */
export function familyHash(input: string): string {
  // FNV-1a: tiny, dependency-free, good enough to group like with like.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/* ------------------------------- serializing ------------------------------ */

const MAX_STRING = 8_000;

/**
 * Make an arbitrary value safe to store as JSON: unwrap Errors, truncate long
 * strings, drop functions, and break cycles. Watchers hand user data (request
 * bodies, job payloads, event payloads) straight through, so this is the barrier
 * that keeps one weird value from poisoning the whole store.
 */
export function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value ?? null;
  const t = typeof value;
  if (t === "string") {
    const s = value as string;
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}… (${s.length} chars)` : s;
  }
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  if (t === "function" || t === "symbol") return `[${t}]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: (value.stack ?? "").split("\n").map((l) => l.trim()),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);
    if (Array.isArray(value)) return value.slice(0, 200).map((v) => jsonSafe(v, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonSafe(v, seen);
    }
    return out;
  }
  return String(value);
}

const REDACTED = "[redacted]";
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);

/** Redact auth/cookie headers before an entry is stored or shown. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

/** Collapse a SQL statement to its shape, so `id = 1` and `id = 2` group together. */
export function sqlShape(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/'[^']*'/g, "?")
    .replace(/\b\d+\b/g, "?")
    .trim()
    .toLowerCase();
}
