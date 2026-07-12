/**
 * Webhook-signature primitives. Stripe and Paddle both sign webhooks with
 * HMAC-SHA256 rendered as lowercase hex. The framework's own hex-HMAC helper
 * (`src/core/http/router.ts`) and constant-time compare (`src/core/crypto.ts`)
 * aren't exported, so we vendor tiny copies here — edge-safe Web Crypto, no
 * `node:crypto`, consistent with how the rest of Keel signs.
 */

/** HMAC-SHA256 of `data` under `secret`, as lowercase hex. */
export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent, constant-time string comparison (avoids timing leaks). */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const av = enc.encode(a);
  const bv = enc.encode(b);
  // Compare against the longer length so mismatched lengths still take the same
  // path; the length inequality alone decides the result.
  let diff = av.length ^ bv.length;
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) diff |= (av[i] ?? 0) ^ (bv[i] ?? 0);
  return diff === 0;
}
