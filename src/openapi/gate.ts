/**
 * Who may see the docs. A spec advertises your whole API surface, so it's gated
 * shut in production by default — open only when `app.debug` is on, outside
 * production, or when you set `public: true`. Override with `OpenApi.auth()`.
 */

import { config } from "../core/helpers.js";
import type { Ctx } from "../core/http/router.js";
import type { OpenApiConfig } from "./config.js";

export type OpenApiGate = (c: Ctx) => boolean | Promise<boolean>;

let gate: OpenApiGate | undefined;

export const OpenApi = {
  /** Restrict docs access. Return true to allow the request. */
  auth(fn: OpenApiGate): void {
    gate = fn;
  },
  /** Remove a custom gate, reverting to the default. */
  clearAuth(): void {
    gate = undefined;
  },
};

function defaultGate(cfg: OpenApiConfig): boolean {
  if (cfg.public) return true;
  if (config<boolean>("app.debug", false)) return true;
  return config<string>("app.env", "production") !== "production";
}

export async function passesGate(c: Ctx, cfg: OpenApiConfig): Promise<boolean> {
  return gate ? gate(c) : defaultGate(cfg);
}
