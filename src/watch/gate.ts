/**
 * Who may see the dashboard. It exposes requests, payloads, and stack traces, so
 * it must never be world-readable in production. By default it's open only when
 * `app.debug` is on or the app isn't in production; call `Watch.auth()` to plug
 * in your own check (an admin session, an allow-list) — mirrors Telescope's gate.
 */

import { config } from "../core/helpers.js";
import type { Ctx } from "../core/http/router.js";

export type WatchGate = (c: Ctx) => boolean | Promise<boolean>;

let gate: WatchGate | undefined;

export const Watch = {
  /**
   * Restrict dashboard access. Return true to allow the request.
   *
   *   Watch.auth((c) => auth().check() && auth().user()?.isAdmin);
   */
  auth(fn: WatchGate): void {
    gate = fn;
  },

  /** Remove a custom gate, reverting to the default. */
  clearAuth(): void {
    gate = undefined;
  },
};

/** Allow when debugging, or anywhere that isn't production. */
function defaultGate(): boolean {
  if (config<boolean>("app.debug", false)) return true;
  return config<string>("app.env", "production") !== "production";
}

/** Whether the current request may see the dashboard. */
export async function passesGate(c: Ctx): Promise<boolean> {
  return gate ? gate(c) : defaultGate();
}
