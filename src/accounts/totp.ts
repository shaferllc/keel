/**
 * TOTP (RFC 6238) — the authenticator-app second factor.
 *
 *   const secret = generateSecret();                  // base32, shown once
 *   const uri = otpauthUri({ secret, account: "ada@example.com", issuer: "Acme" });
 *   const ok = await verifyTotp(secret, "492039");
 *
 * Deliberately edge-safe: WebCrypto + base32 for the codes, and `uqr` for a local
 * SVG QR so the shared secret never hits a third-party image CDN.
 */

import { renderSVG } from "uqr";

/* --------------------------------- base32 --------------------------------- */

// RFC 4648, upper-case, no padding — what authenticator apps expect in a URI.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // Whatever's left, left-aligned in a final group.
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];

  return out;
}

export function base32Decode(input: string): Uint8Array {
  // Users paste secrets by hand: tolerate spaces, lower case, and padding.
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`"${char}" is not valid base32.`);

    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(out);
}

/* --------------------------------- secrets -------------------------------- */

/** A new TOTP secret: 160 bits, base32-encoded. Show it once, store it encrypted. */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export interface TotpOptions {
  /** Code length. 6 is what every authenticator app shows. */
  digits?: number;
  /** Seconds each code is valid for. */
  period?: number;
  /** Unix seconds; defaults to now. */
  timestamp?: number;
}

/* ---------------------------------- codes --------------------------------- */

/** The code for a secret at a moment in time. */
export async function totp(secret: string, options: TotpOptions = {}): Promise<string> {
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  const now = options.timestamp ?? Math.floor(Date.now() / 1000);

  const counter = Math.floor(now / period);

  // The counter is a 64-bit big-endian integer. JS bitwise ops are 32-bit, so
  // the halves are written separately rather than shifted.
  const message = new Uint8Array(8);
  new DataView(message.buffer).setUint32(0, Math.floor(counter / 2 ** 32), false);
  new DataView(message.buffer).setUint32(4, counter >>> 0, false);

  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message as unknown as ArrayBuffer));

  // Dynamic truncation (RFC 4226 §5.3): the low nibble of the last byte picks
  // which four bytes of the MAC become the code.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export interface VerifyOptions extends TotpOptions {
  /**
   * How many periods either side of now to accept. 1 (the default) tolerates a
   * phone whose clock drifts by up to 30 seconds — which is common enough that 0
   * generates support tickets, and large values just widen the guessing window.
   */
  window?: number;
}

/**
 * Is this the code for that secret, right now?
 *
 * Compared in constant time, and every candidate in the window is checked even
 * after a match, so the time this takes says nothing about which period matched.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  options: VerifyOptions = {},
): Promise<boolean> {
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  const window = options.window ?? 1;
  const now = options.timestamp ?? Math.floor(Date.now() / 1000);

  const supplied = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(supplied)) return false;

  let matched = false;
  for (let drift = -window; drift <= window; drift++) {
    const candidate = await totp(secret, {
      digits,
      period,
      timestamp: now + drift * period,
    });
    // No early return: the loop runs the same number of times either way.
    if (timingSafeEqual(candidate, supplied)) matched = true;
  }

  return matched;
}

/* ----------------------------------- uri ---------------------------------- */

export interface OtpauthOptions {
  secret: string;
  /** Who the account belongs to — shown in the authenticator app. */
  account: string;
  /** Your app's name — shown above the account. */
  issuer: string;
  digits?: number;
  period?: number;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * Prefer {@link otpauthQrDataUrl} / {@link otpauthQrSvg} for the on-screen code —
 * never post this URI to a QR-image CDN: it contains the shared secret.
 */
export function otpauthUri(options: OtpauthOptions): string {
  const label = `${options.issuer}:${options.account}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: "SHA1",
    digits: String(options.digits ?? 6),
    period: String(options.period ?? 30),
  });

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Inline SVG for an `otpauth://` URI — generated locally so the secret never
 * leaves the process (no third-party QR CDN).
 */
export function otpauthQrSvg(uri: string): string {
  return renderSVG(uri, { ecc: "M", border: 2 });
}

/** `data:image/svg+xml;base64,…` for an `<img src>` — safer in attributes than utf8. */
export function otpauthQrDataUrl(uri: string): string {
  const svg = otpauthQrSvg(uri);
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/* --------------------------------- helpers -------------------------------- */

/** Compare without leaking, through timing, how much of the code was right. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
