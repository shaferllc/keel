import { HttpKernel, serveStatic, sessionMiddleware } from "@shaferllc/keel/core";
import type { Application } from "@shaferllc/keel/core";
import { teamContext } from "@shaferllc/keel/teams";

import { requestLogger } from "./Middleware/requestLogger.js";

/**
 * Global middleware — runs on every request, in order.
 *
 * `teamContext()` puts the request inside the signed-in user's current team, which
 * is what scopes every `TenantModel` without a single handler doing anything. It
 * verifies membership rather than trusting `users.current_team_id` — that column is
 * a number on a row the user can influence, so switching teams would otherwise be a
 * matter of writing someone else's id into it.
 *
 * It must run after the session, or there's no user to resolve a team for.
 */
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);

    this.use(requestLogger);
    this.use(serveStatic({ root: "./public" }));
    this.use(sessionMiddleware());
    this.use(teamContext());
  }
}
