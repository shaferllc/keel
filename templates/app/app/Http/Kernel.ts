import { HttpKernel, serveStatic, sessionMiddleware } from "@shaferllc/keel/core";
import type { Application } from "@shaferllc/keel/core";

import { requestLogger } from "./Middleware/requestLogger.js";

/**
 * Global middleware — runs on every request, in order.
 *
 * Keel's own `serveStatic` (not `@hono/node-server`'s) because this kernel also runs
 * inside the Worker: it imports `node:fs` dynamically, so it loads on the edge.
 * Files resolve as `root + path` — /assets/app.css is ./public/assets/app.css.
 */
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);

    this.use(requestLogger);
    this.use(serveStatic({ root: "./public" }));
    this.use(sessionMiddleware());
  }
}
