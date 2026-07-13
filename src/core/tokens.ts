/**
 * Personal access tokens — opaque, database-backed bearer tokens for API and
 * mobile clients, an alternative to the stateless [`jwt`](./crypto.ts). Unlike a
 * JWT, an opaque token can be *revoked* instantly (it's a row you delete), carries
 * *abilities* (scopes), and tracks *last used* — at the cost of a lookup per
 * request. Built on the `db()` layer, so it runs anywhere a `Connection` does.
 *
 *   const { token } = await createToken(user.id, { abilities: ["posts:write"] });
 *   // → "keel_<selector>.<verifier>"  — show once, never recoverable
 *
 *   const record = await verifyToken(token);  // { tokenableId, abilities, … } | null
 *   tokenAllows(record, "posts:write");        // true
 *
 * Pair it with `tokenAuth()` in ./auth.ts to protect routes. The token splits
 * into a public *selector* (indexed, for lookup) and a secret *verifier* (stored
 * only as a SHA-256 hash) — so a leaked database can't mint working tokens, and
 * verification needs no `RETURNING`/auto-increment (portable across every driver).
 *
 * Expected table (`personal_access_tokens` by default), all timestamps epoch-ms:
 *   selector TEXT UNIQUE, hash TEXT, tokenable_id TEXT, name TEXT,
 *   abilities TEXT (JSON), last_used_at INTEGER, expires_at INTEGER, created_at INTEGER
 */

import { db } from "./database.js";

/** A verified token, as returned by `verifyToken`. */
export interface AccessToken {
  /** Public lookup key (the part before the `.`). Pass to `revokeToken`. */
  selector: string;
  /** The id of the entity the token belongs to (usually a user id). */
  tokenableId: string;
  /** Optional human label, for a "your tokens" management screen. */
  name: string | null;
  /** Granted abilities/scopes; `["*"]` means all. */
  abilities: string[];
  /** Epoch-ms of last successful use, or null if never (updated on verify). */
  lastUsedAt: number | null;
  /** Epoch-ms expiry, or null for a token that never expires. */
  expiresAt: number | null;
}

export interface CreateTokenOptions {
  /** Abilities/scopes to grant. Defaults to `["*"]` (everything). */
  abilities?: string[];
  /** Lifetime — seconds (number) or a duration string (`"30d"`, `"12h"`). No expiry if omitted. */
  expiresIn?: number | string;
  /** A human label for the token. */
  name?: string;
  /** Which registered connection to store the token on. */
  connection?: string;
}

export interface IssuedToken {
  /** The plaintext token — `keel_<selector>.<verifier>`. Shown once; store the hash only. */
  token: string;
  selector: string;
  abilities: string[];
  expiresAt: number | null;
}

/** The table tokens are stored in; override with `setTokensTable`. */
let table = "personal_access_tokens";

/** Change the table personal access tokens are stored in (default `personal_access_tokens`). */
export function setTokensTable(name: string): void {
  table = name;
}

/* -------------------------------- crypto -------------------------------- */

const DURATION = /^(\d+)\s*(s|m|h|d)$/;
const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

function seconds(value: number | string): number {
  if (typeof value === "number") return value;
  const match = DURATION.exec(value.trim());
  if (!match) throw new Error(`Invalid duration "${value}" (use e.g. 3600, "30m", "12h", "30d").`);
  return Number(match[1]) * UNIT[match[2]!]!;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(size: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}

/** SHA-256 of the verifier, base64url — what we actually persist. */
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value) as unknown as ArrayBuffer);
  return base64url(new Uint8Array(digest));
}

/** Constant-time string compare, so a bad hash can't be timed byte-by-byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/* ------------------------------- lifecycle ------------------------------ */

/** Mint a new access token for an entity. Returns the plaintext once — persist nothing but the hash. */
export async function createToken(tokenableId: string | number, options: CreateTokenOptions = {}): Promise<IssuedToken> {
  const selector = randomToken(12);
  const verifier = randomToken(24);
  const abilities = options.abilities ?? ["*"];
  const expiresAt = options.expiresIn != null ? Date.now() + seconds(options.expiresIn) * 1000 : null;

  await db(table, options.connection).insert({
    selector,
    hash: await sha256(verifier),
    tokenable_id: String(tokenableId),
    name: options.name ?? null,
    abilities: JSON.stringify(abilities),
    last_used_at: null,
    expires_at: expiresAt,
    created_at: Date.now(),
  });

  return { token: `keel_${selector}.${verifier}`, selector, abilities, expiresAt };
}

/**
 * Verify a plaintext token and return its record, or `null` if it's malformed,
 * unknown, tampered, or expired. On success it stamps `last_used_at`. An expired
 * token is deleted in passing, so the table self-prunes as stale tokens are tried.
 */
export async function verifyToken(token: string, connection?: string): Promise<AccessToken | null> {
  const match = /^keel_([^.]+)\.(.+)$/.exec(token);
  if (!match) return null;
  const selector = match[1]!;
  const verifier = match[2]!;

  const row = await db(table, connection).where("selector", selector).first();
  if (!row) return null;

  if (!safeEqual(await sha256(verifier), String(row.hash))) return null;

  const expiresAt = row.expires_at != null ? Number(row.expires_at) : null;
  if (expiresAt != null && Date.now() >= expiresAt) {
    await db(table, connection).where("selector", selector).delete();
    return null;
  }

  const now = Date.now();
  await db(table, connection).where("selector", selector).update({ last_used_at: now });

  return {
    selector,
    tokenableId: String(row.tokenable_id),
    name: (row.name as string | null) ?? null,
    abilities: parseAbilities(row.abilities),
    lastUsedAt: now,
    expiresAt,
  };
}

/** Whether a verified token grants an ability (`["*"]` grants everything). */
export function tokenAllows(token: AccessToken | null | undefined, ability: string): boolean {
  if (!token) return false;
  return token.abilities.includes("*") || token.abilities.includes(ability);
}

/** The negation of `tokenAllows`. */
export function tokenDenies(token: AccessToken | null | undefined, ability: string): boolean {
  return !tokenAllows(token, ability);
}

/** Revoke a single token by its selector (the part before the `.`). */
export async function revokeToken(selector: string, connection?: string): Promise<void> {
  await db(table, connection).where("selector", selector).delete();
}

/** Revoke every token belonging to an entity — a "log out everywhere" switch. */
export async function revokeTokens(tokenableId: string | number, connection?: string): Promise<void> {
  await db(table, connection).where("tokenable_id", String(tokenableId)).delete();
}

/** List an entity's tokens (metadata only — the secret is never stored). */
export async function listTokens(tokenableId: string | number, connection?: string): Promise<AccessToken[]> {
  const rows = await db(table, connection).where("tokenable_id", String(tokenableId)).get();
  return rows.map((row) => ({
    selector: String(row.selector),
    tokenableId: String(row.tokenable_id),
    name: (row.name as string | null) ?? null,
    abilities: parseAbilities(row.abilities),
    lastUsedAt: row.last_used_at != null ? Number(row.last_used_at) : null,
    expiresAt: row.expires_at != null ? Number(row.expires_at) : null,
  }));
}

function parseAbilities(value: unknown): string[] {
  if (typeof value !== "string") return Array.isArray(value) ? (value as string[]) : ["*"];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : ["*"];
  } catch {
    return ["*"];
  }
}

/** Schema for personal access tokens (SQLite-friendly; works on Postgres with minor tweaks). */
export function tokensMigration(tableName = "personal_access_tokens"): import("./migrations.js").Migration {
  return {
    name: `tokens_00_${tableName}`,
    async up(schema) {
      await schema.raw(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          selector TEXT NOT NULL UNIQUE,
          hash TEXT NOT NULL,
          tokenable_id TEXT NOT NULL,
          name TEXT,
          abilities TEXT,
          last_used_at INTEGER,
          expires_at INTEGER,
          created_at INTEGER
        )
      `);
      await schema.raw(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_tokenable ON ${tableName} (tokenable_id)`,
      );
    },
    async down(schema) {
      await schema.dropTable(tableName).catch(() => {});
    },
  };
}
