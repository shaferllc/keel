import type { Ctx } from "@shaferllc/keel/core";

/** Log every request with its status and how long it took. */
export async function requestLogger(c: Ctx, next: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms`);
}
