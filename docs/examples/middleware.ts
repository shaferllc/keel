// Type-check harness for docs/middleware.md. Every type-checkable snippet in the
// guide is exercised here against the real exports, so a renamed method or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  HttpKernel,
  Application,
  Router,
  UnauthorizedException,
  type MiddlewareRef,
  type RouteHandler,
} from "@shaferllc/keel/core";
import type { MiddlewareHandler } from "hono";

// Externals the snippets reference.
declare const router: Router;
declare const handler: RouteHandler;
declare function lookupUser(auth?: string): Promise<{ id: number; name: string }>;

// Example middleware — the shape everything else registers.
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`  ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
};

const cors: MiddlewareHandler = async (_c, next) => {
  await next();
};
const requestId: MiddlewareHandler = async (_c, next) => {
  await next();
};

// The HTTP kernel — global middleware + custom error handler.
export class Kernel extends HttpKernel {
  constructor(app: Application) {
    super(app);
    this.use(requestLogger).use(cors).use(requestId);
    this.onError((err, c) => c.json({ error: String(err) }, 500));
  }
}

export function buildKernel(app: Application) {
  const kernel = new Kernel(app);
  return kernel.build();
}

// Short-circuiting.
export const requireApiKey: MiddlewareHandler = async (c, next) => {
  if (c.req.header("x-api-key") !== process.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

class Auth {
  check(): boolean {
    return true;
  }
}
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!c.get("app").make(Auth).check()) throw new UnauthorizedException();
  await next();
};

// Sharing data with handlers.
export const withUser: MiddlewareHandler = async (c, next) => {
  c.set("user", await lookupUser(c.req.header("authorization")));
  await next();
};

export const noCache: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};

// Parameterized middleware via a factory.
const role = (name: string): MiddlewareHandler => async (_c, next) => {
  void name;
  await next();
};

// Named middleware + applying refs to routes, groups, resources.
class DashboardController {}
class PostController {}
class AdminController {}
class ReportController {}
const authMiddleware = requireAuth;
const adminMiddleware = requireAuth;
const auditLog = requestLogger;

export function named() {
  router.named({ auth: authMiddleware, admin: adminMiddleware });
  router.named({ admin: role("admin"), editor: role("editor") });

  router.get("/dashboard", [DashboardController, "index"]).use("auth");
  router.group(() => {
    /* … */
  }).use(["auth", "admin"]);
  router.resource("posts", PostController).use(["store", "update"], "auth");
  router.resource("admin", AdminController).use("*", "admin");

  router.get("/reports", [ReportController, "index"]).use(["auth", auditLog]);
  router.get("/admin", handler).use(role("admin"));
  router.get("/reports2", handler).middleware(["auth", auditLog]);

  const mw = router.resolveMiddleware("auth");
  return mw;
}

export function groupOrdering() {
  router.group(() => {
    router.get("/posts/:id/edit", handler).use("owns-post");
  }).use("auth");
}

// Type seams.
const guards: MiddlewareRef[] = ["auth", auditLog];
export { guards };
