/**
 * Hostname helpers for custom domains / Workers Custom Domains.
 */

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeHostname(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, "").replace(/^https?:\/\//, "").split("/")[0]!;
}

export function isValidHostname(hostname: string): boolean {
  if (!HOSTNAME_RE.test(hostname)) return false;
  if (hostname.includes("..")) return false;
  return true;
}

/** Zone name candidates from most specific to apex (e.g. app.ex.com → app.ex.com, ex.com). */
export function zoneCandidates(hostname: string): string[] {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i <= parts.length - 2; i++) {
    out.push(parts.slice(i).join("."));
  }
  return out;
}
