/**
 * Password hashing and value encryption — both built on the Web Crypto API, so
 * they work the same on Node and the edge (no native bindings, no bcrypt).
 *
 *   const hashed = await hash.make(password);
 *   await hash.verify(hashed, password);        // boolean
 *
 *   const token = await encryption.encrypt({ userId: 1 });
 *   await encryption.decrypt(token);             // { userId: 1 } | null
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

  /** Verify a password against a stored hash. */
  async verify(hashed: string, password: string): Promise<boolean> {
    const [algo, iter, salt64, hash64] = hashed.split("$");
    if (algo !== "pbkdf2_sha256" || !iter || !salt64 || !hash64) return false;
    const derived = await pbkdf2(password, fromB64(salt64), Number(iter));
    return safeEqual(b64(derived), hash64);
  },

  /** Whether a hash was made with fewer iterations than the current default. */
  needsRehash(hashed: string, iterations = DEFAULT_ITERATIONS): boolean {
    const iter = Number(hashed.split("$")[1]);
    return !iter || iter < iterations;
  },
};

/* ----------------------------- encryption ------------------------------ */

async function aesKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(appKey()) as unknown as ArrayBuffer);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const encryption = {
  /** Encrypt any JSON-serializable value (AES-GCM), keyed by config('app.key'). */
  async encrypt(value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(value));
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as ArrayBuffer }, await aesKey(), data as unknown as ArrayBuffer),
    );
    const packed = new Uint8Array(iv.length + cipher.length);
    packed.set(iv);
    packed.set(cipher, iv.length);
    return b64(packed);
  },

  /** Decrypt a value; returns null if the payload is tampered or invalid. */
  async decrypt<T = unknown>(payload: string): Promise<T | null> {
    try {
      const bytes = fromB64(payload);
      const iv = bytes.slice(0, 12);
      const cipher = bytes.slice(12);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
        await aesKey(),
        cipher as unknown as ArrayBuffer,
      );
      return JSON.parse(new TextDecoder().decode(plain)) as T;
    } catch {
      return null;
    }
  },
};
