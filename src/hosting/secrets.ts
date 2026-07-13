/**
 * Encrypted key/value secrets vault — purpose-scoped encryption via Keel core.
 *
 * Apps supply a table of rows with `owner_id`, `key`, `value_encrypted`.
 * This helper doesn't own the model; it encrypts/decrypts values.
 */

import { encryption } from "../core/crypto.js";

export type SecretRow = {
  key: string;
  value_encrypted: string;
};

export function normalizeSecretKey(key: string): string {
  return key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

export async function encryptSecretValue(
  value: string,
  purpose = "app-secret",
): Promise<string> {
  return encryption.encrypt(value, { purpose });
}

export async function decryptSecretValue(
  payload: string,
  purpose = "app-secret",
): Promise<string | null> {
  const value = await encryption.decrypt<string>(payload, { purpose });
  return typeof value === "string" ? value : null;
}

/** Decrypt a list of encrypted rows into a plain key→value map. */
export async function resolveSecretRows(
  rows: SecretRow[],
  purpose = "app-secret",
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const value = await decryptSecretValue(row.value_encrypted, purpose);
    if (value !== null) out[row.key] = value;
  }
  return out;
}
