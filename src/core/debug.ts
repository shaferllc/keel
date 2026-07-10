/**
 * Debugging helpers. `dump()` prints values to the console; `dd()` dumps and
 * dies — it halts the request and renders the values in the browser. Both are
 * edge-safe (plain console + a self-rendering exception).
 *
 *   dump(user, order);          // logs, keeps going
 *   dd(request.headers());       // renders and stops the request
 */

import type { Context } from "hono";
import { HttpException } from "./exceptions.js";

/** Safe, pretty JSON — handles circular refs, functions, and bigints. */
function stringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      if (typeof val === "function") return `[Function: ${val.name || "anonymous"}]`;
      if (typeof val === "bigint") return `${val}n`;
      if (val === undefined) return "[undefined]";
      return val;
    },
    2,
  );
}

/** Print values to the console. Returns the first value, so it can be inlined. */
export function dump<T>(...values: [T, ...unknown[]]): T {
  console.log("⚓ dump →", ...values);
  return values[0];
}

class DumpException extends HttpException {
  constructor(private values: unknown[]) {
    super(200);
    this.name = "DumpException";
  }

  handle(c: Context): Response {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const blocks = this.values
      .map((v) => `<pre>${esc(stringify(v))}</pre>`)
      .join("");
    return c.html(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>dump</title><style>
        body{margin:0;background:#0b1120;color:#e2e8f0;font-family:ui-monospace,Menlo,monospace;padding:2rem}
        h1{font-size:.8rem;letter-spacing:.15em;text-transform:uppercase;color:#f87171;margin:0 0 1rem}
        pre{background:#020617;border:1px solid #1e293b;border-radius:.5rem;padding:1.2rem;overflow-x:auto;font-size:.85rem;line-height:1.6;margin:0 0 1rem}
      </style></head><body><h1>⚓ dump &amp; die</h1>${blocks}</body></html>`,
      200 as never,
    );
  }
}

/** Dump values to the browser and halt the request. */
export function dd(...values: unknown[]): never {
  throw new DumpException(values);
}
