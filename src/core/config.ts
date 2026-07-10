/**
 * Config repository with dot-notation access.
 *
 * Config files live in /config and export a default object. They are loaded
 * at boot and merged under their filename: config/app.ts -> config('app.*').
 */

export type ConfigData = Record<string, unknown>;

export class Config {
  constructor(private items: ConfigData = {}) {}

  /** config('app.name') or config('app.name', 'Fallback'). */
  get<T = unknown>(key: string, fallback?: T): T {
    const segments = key.split(".");
    let current: unknown = this.items;

    for (const segment of segments) {
      if (current !== null && typeof current === "object" && segment in current) {
        current = (current as Record<string, unknown>)[segment];
      } else {
        return fallback as T;
      }
    }

    return current as T;
  }

  set(key: string, value: unknown): void {
    const segments = key.split(".");
    const last = segments.pop()!;
    let current = this.items;

    for (const segment of segments) {
      if (typeof current[segment] !== "object" || current[segment] === null) {
        current[segment] = {};
      }
      current = current[segment] as ConfigData;
    }

    current[last] = value;
  }

  all(): ConfigData {
    return this.items;
  }
}

/** Read an env var with an optional typed fallback (true/false/number coerced). */
export function env<T = string>(key: string, fallback?: T): T {
  const raw = process.env[key];
  if (raw === undefined) return fallback as T;

  if (raw === "true") return true as T;
  if (raw === "false") return false as T;
  if (raw !== "" && !Number.isNaN(Number(raw)) && typeof fallback === "number") {
    return Number(raw) as T;
  }
  return raw as T;
}
