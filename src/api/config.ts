/**
 * API-resource defaults. Read off `config("api")`, so an app can set global
 * pagination limits in `config/api.ts`; every `apiResource()` inherits them and
 * can override per-resource.
 */

import { config } from "../core/helpers.js";

export interface ApiConfig {
  /** Default page size for list endpoints. */
  perPage: number;
  /** Hard ceiling on `?perPage=` — the guard against "give me everything". */
  maxPerPage: number;
}

export const defaultConfig: ApiConfig = {
  perPage: 25,
  maxPerPage: 100,
};

export function apiDefaults(): ApiConfig {
  const raw = config<Partial<ApiConfig>>("api", {});
  return { ...defaultConfig, ...raw };
}
