// Type-check harness for docs/hosting.md. Compile-only — never executed.
import type { Connection } from "@shaferllc/keel/core";
import {
  CloudflareClient,
  cloudflareConfigured,
  normalizeHostname,
  isValidHostname,
  zoneCandidates,
  dumpConnection,
  normalizeSecretKey,
  encryptSecretValue,
  decryptSecretValue,
  resolveSecretRows,
} from "@shaferllc/keel/hosting";

export function client() {
  const creds = { accountId: "acct", apiToken: "tok" };
  if (!cloudflareConfigured(creds)) throw new Error("missing");
  return new CloudflareClient(creds);
}

export function hostnames(raw: string) {
  const host = normalizeHostname(raw);
  return { host, valid: isValidHostname(host), zones: zoneCandidates(host) };
}

export async function dump(conn: Connection) {
  return dumpConnection(conn, "Acme local D1", { generatedBy: "Keel Cloud" });
}

export async function vault(secret: string) {
  const key = normalizeSecretKey("stripe-secret-key");
  const encrypted = await encryptSecretValue(secret, "app-secret");
  const plain = await decryptSecretValue(encrypted, "app-secret");
  const env = await resolveSecretRows([{ key, value_encrypted: encrypted }], "app-secret");
  return { key, plain, env };
}
