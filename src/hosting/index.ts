/**
 * Keel Hosting — Cloudflare client, hostname helpers, SQL dump, secrets vault.
 *
 *   import { CloudflareClient, dumpConnection, normalizeHostname } from "@shaferllc/keel/hosting";
 *
 * This is infrastructure for hosted Workers/D1 apps — not a full control plane.
 * Product orchestration (sites, plans, deploy loops) stays in the app.
 */

export {
  CloudflareClient,
  cloudflareConfigured,
} from "./cloudflare.js";
export type { CloudflareCredentials, WorkerDomain } from "./cloudflare.js";

export { normalizeHostname, isValidHostname, zoneCandidates } from "./hostname.js";

export { dumpConnection } from "./dump.js";

export {
  normalizeSecretKey,
  encryptSecretValue,
  decryptSecretValue,
  resolveSecretRows,
} from "./secrets.js";
export type { SecretRow } from "./secrets.js";
