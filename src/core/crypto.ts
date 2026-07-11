/**
 * Password hashing and value encryption — both built on the Web Crypto API, so
 * they work the same on Node and the edge (no native bindings, no bcrypt).
 *
 *   const hashed = await hash.make(password);
 *   await hash.verify(hashed, password);        // boolean
 *
 *   const token = await encryption.encrypt({ userId: 1 });
 *   await encryption.decrypt(token);             // { userId: 1 } | null
 *
 *   const token = await jwt.sign({ sub: "42" }, { expiresIn: "1h" });
 *   await jwt.verify(token);                      // { sub: "42", iat, exp } | null
 */

import { config } from "./helpers.js";

/* --------------------------- shared utilities -------------------------- */

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}
function fromB64(str: string): Uint8Array {
  const s = atob(str);
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function appKey(): string {
  const key = config<string>("app.key", "");
  if (!key) throw new Error("Encryption requires config('app.key'). Set APP_KEY.");
  return key;
}

/* ------------------------------- hashing ------------------------------- */

const DEFAULT_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export const hash = {
  /** Hash a password (PBKDF2-SHA256 with a random salt). */
  async make(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await pbkdf2(password, salt, iterations);
    return `pbkdf2_sha256$${iterations}$${b64(salt)}$${b64(derived)}`;
  },

  /** Verify a password against a stored hash. Returns false for any malformed hash. */
  async verify(hashed: string, password: string): Promise<boolean> {
    const [algo, iter, salt64, hash64] = hashed.split("$");
    if (algo !== "pbkdf2_sha256" || !iter || !salt64 || !hash64) return false;
    const iterations = Number(iter);
    if (!Number.isInteger(iterations) || iterations < 1) return false;
    try {
      const derived = await pbkdf2(password, fromB64(salt64), iterations);
      return safeEqual(b64(derived), hash64);
    } catch {
      // Malformed base64 salt/hash, etc. — treat as a non-match, never throw.
      return false;
    }
  },

  /** Whether a hash was made with fewer iterations than the current default. */
  needsRehash(hashed: string, iterations = DEFAULT_ITERATIONS): boolean {
    const iter = Number(hashed.split("$")[1]);
    return !iter || iter < iterations;
  },

  /**
   * A valid dummy hash (of a random secret) at the default cost. Compare against
   * it when a user *isn't* found so login spends the same time as a wrong
   * password — otherwise a fast "no such user" response leaks which emails are
   * registered (a timing/enumeration attack).
   *
   *   const user = await findUserByEmail(email);
   *   const ok = await hash.verify(user?.password ?? hash.dummy, password);
   *   if (ok && user) auth().login(user.id);   // `user &&` so the dummy never authenticates
   */
  dummy: "pbkdf2_sha256$100000$7uVVFNW3RCry5kPKJQUgTw==$fOfxeFDnxv5A3rhl6bcWGKJQhmcK8x6XNfe9Z88WO/A=",
};

/* ----------------------------- encryption ------------------------------ */

async function aesKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(appKey()) as unknown as ArrayBuffer);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export interface EncryptOptions {
  /** Time-to-live — seconds (number) or a duration string (`"30m"`, `"1h"`, `"7d"`). */
  expiresIn?: number | string;
  /** Bind the token to a context; `decrypt` must pass the same `purpose` or gets `null`. */
  purpose?: string;
}

export const encryption = {
  /**
   * Encrypt any JSON-serializable value (AES-GCM), keyed by `config('app.key')`.
   * `expiresIn` makes the token self-expire; `purpose` binds it to a context
   * (e.g. `"password-reset"`) so a token minted for one use can't be replayed for
   * another.
   */
  async encrypt(value: unknown, options: EncryptOptions = {}): Promise<string> {
    // Wrap in a small envelope so expiry/purpose travel inside the ciphertext.
    const envelope: Record<string, unknown> = { __k: 1, v: value };
    if (options.expiresIn != null) envelope.exp = Date.now() + seconds(options.expiresIn) * 1000;
    if (options.purpose != null) envelope.p = options.purpose;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(envelope));
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as ArrayBuffer }, await aesKey(), data as unknown as ArrayBuffer),
    );
    const packed = new Uint8Array(iv.length + cipher.length);
    packed.set(iv);
    packed.set(cipher, iv.length);
    return b64(packed);
  },

  /**
   * Decrypt a value; returns `null` if the payload is tampered, invalid, expired,
   * or minted for a different `purpose`. Never throws.
   */
  async decrypt<T = unknown>(payload: string, options: { purpose?: string } = {}): Promise<T | null> {
    try {
      const bytes = fromB64(payload);
      const iv = bytes.slice(0, 12);
      const cipher = bytes.slice(12);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
        await aesKey(),
        cipher as unknown as ArrayBuffer,
      );
      const parsed = JSON.parse(new TextDecoder().decode(plain)) as unknown;

      // Envelope (new format): enforce expiry + purpose.
      if (parsed && typeof parsed === "object" && (parsed as { __k?: number }).__k === 1) {
        const env = parsed as { v: T; exp?: number; p?: string };
        if (typeof env.exp === "number" && Date.now() >= env.exp) return null;
        if ((options.purpose ?? null) !== (env.p ?? null)) return null;
        return env.v;
      }
      // Legacy plain value (encrypted before envelopes). A required purpose can't match.
      if (options.purpose != null) return null;
      return parsed as T;
    } catch {
      return null;
    }
  },
};

/* ---------------------------------- jwt --------------------------------- */

/*
 * Stateless bearer tokens — an HS256 JWT signed with `config('app.key')`, built
 * on the same Web Crypto primitives as `hash`/`encryption` (no `jsonwebtoken`,
 * no native bindings, runs on the edge). This is the token half of the auth
 * story; `bearerAuth()` in ./auth.ts verifies these on the way in.
 */

/** Standard registered claims, plus whatever custom fields you sign. */
export interface JwtPayload {
  /** Subject — conventionally the user id. */
  sub?: string;
  /** Issued-at (seconds since the epoch); set automatically by `sign`. */
  iat?: number;
  /** Expiry (seconds since the epoch); set from `expiresIn`. */
  exp?: number;
  /** Not-before (seconds since the epoch); the token is invalid until then. */
  nbf?: number;
  /** Issuer. */
  iss?: string;
  /** Audience. */
  aud?: string;
  [claim: string]: unknown;
}

export interface JwtSignOptions {
  /** Lifetime — seconds (number) or a duration string like `"30s"`, `"15m"`, `"1h"`, `"7d"`. */
  expiresIn?: number | string;
  /** Sets the `iss` claim. */
  issuer?: string;
  /** Sets the `aud` claim. */
  audience?: string;
  /** Sets the `sub` claim (overrides any `sub` already in the payload). */
  subject?: string;
  /** Signing secret; defaults to `config('app.key')`. */
  secret?: string;
}

export interface JwtVerifyOptions {
  /** Require this `iss`; a token that doesn't match is rejected. */
  issuer?: string;
  /** Require this `aud`; a token that doesn't match is rejected. */
  audience?: string;
  /** Verifying secret; defaults to `config('app.key')`. */
  secret?: string;
}

const DURATION = /^(\d+)\s*(s|m|h|d)$/;
const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Coerce a lifetime to seconds — a bare number passes through; `"1h"` → 3600. */
function seconds(value: number | string): number {
  if (typeof value === "number") return value;
  const match = DURATION.exec(value.trim());
  if (!match) throw new Error(`Invalid duration "${value}" (use e.g. 30, "30s", "15m", "1h", "7d").`);
  return Number(match[1]) * UNIT[match[2]!]!;
}

/* base64url — JWT segments use the URL-safe alphabet with no padding. */
function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(str: string): Uint8Array {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  return fromB64(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
}
function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** HMAC-SHA256 the signing input, returned base64url — the JWT signature. */
async function hmacSha256(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data) as unknown as ArrayBuffer);
  return b64url(new Uint8Array(sig));
}

const JWT_HEADER = b64urlJson({ alg: "HS256", typ: "JWT" });

export const jwt = {
  /** Sign a payload into an HS256 JWT. Adds `iat`, and `exp` when `expiresIn` is set. */
  async sign(payload: JwtPayload, options: JwtSignOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: JwtPayload = { ...payload, iat: now };
    if (options.subject !== undefined) claims.sub = options.subject;
    if (options.issuer !== undefined) claims.iss = options.issuer;
    if (options.audience !== undefined) claims.aud = options.audience;
    if (options.expiresIn !== undefined) claims.exp = now + seconds(options.expiresIn);
    const body = `${JWT_HEADER}.${b64urlJson(claims)}`;
    const sig = await hmacSha256(body, options.secret ?? appKey());
    return `${body}.${sig}`;
  },

  /**
   * Verify an HS256 JWT and return its payload, or `null` if the token is
   * malformed, tampered, expired, not-yet-valid, or fails an issuer/audience
   * check. Only HS256 is accepted — `alg: none` and asymmetric algs are refused,
   * closing the classic JWT algorithm-confusion hole.
   */
  async verify<T extends JwtPayload = JwtPayload>(token: string, options: JwtVerifyOptions = {}): Promise<T | null> {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [header, body, sig] = parts as [string, string, string];

      const alg = (JSON.parse(new TextDecoder().decode(fromB64url(header))) as { alg?: string }).alg;
      if (alg !== "HS256") return null;

      const expected = await hmacSha256(`${header}.${body}`, options.secret ?? appKey());
      if (!safeEqual(sig, expected)) return null;

      const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
      const now = Math.floor(Date.now() / 1000);
      if (typeof claims.exp === "number" && now >= claims.exp) return null;
      if (typeof claims.nbf === "number" && now < claims.nbf) return null;
      if (options.issuer !== undefined && claims.iss !== options.issuer) return null;
      if (options.audience !== undefined && claims.aud !== options.audience) return null;
      return claims;
    } catch {
      return null;
    }
  },
};
