// Type-check harness for docs/routing.md. Every type-checkable snippet in the
// reference is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import {
  Router,
  Route,
  RouteGroup,
  RouteResource,
  matchers,
  json,
  text,
  type Ctx,
  type RouteHandler,
  type RouteDefinition,
  type Method,
  type Matcher,
  type MiddlewareRef,
} from "@shaferllc/keel/core";

// The framework builds the Router and hands it to your routes file; users never
// construct it, so we `declare` one here.
declare const router: Router;
declare const handler: RouteHandler;
declare const auth: MiddlewareRef;
declare const admin: MiddlewareRef;
declare const logRequests: MiddlewareRef;
declare const rateLimiterMw: MiddlewareRef;
declare const user: unknown;
declare const AboutPage: (props?: unknown) => unknown;

// Controllers can be plain classes.
class HomeController {
  index(_c: Ctx) {
    return "home";
  }
}
class UserController {
  show(c: Ctx) {
    return c.json({ id: 1 });
  }
  store(_c: Ctx) {
    return "created";
  }
  destroy(_c: Ctx) {
    return "gone";
  }
}
class PostController {}
class CommentController {}
class HookController {
  handle(_c: Ctx) {
    return "ok";
  }
}
class MeController {
  show(_c: Ctx) {
    return "me";
  }
}

export function verbs() {
  router.get("/users/:id", [UserController, "show"]);
  router.post("/users", [UserController, "store"]);
  router.put("/users/:id", handler);
  router.patch("/users/:id", handler);
  router.delete("/users/:id", [UserController, "destroy"]);
  router.any("/webhook", [HookController, "handle"]);
  router.route(["GET", "POST"], "/search", handler);
}

export function handlerShapes() {
  router.get("/a", (c: Ctx) => c.json({ ok: true })); // HandlerFn
  router.get("/hi/:name", (c: Ctx) => c.text("hi")); // HandlerFn -> string
  router.get("/b", [UserController, "show"]); // ControllerAction
  router.get("/single", [HookController]); // [Controller] -> handle
  router.get("/c", json({ up: true })); // Response
  router.get("/robots.txt", text("User-agent: *"));
}

export function brisk() {
  router.on("/old").redirect("/new");
  router.on("/ext").redirectToPath("https://example.com", 301);
  router.on("/posts").redirectToRoute("articles.index", {}, { qs: { page: 1 } });
  router.on("/about").render(AboutPage, { title: "About" });
  router.on("/dashboard").renderInertia("Dashboard", { user });
}

export function grouping() {
  const g: RouteGroup = router
    .group(() => {
      router.get("/status", json({ up: true })).name("status");
      router.get("/me", [MeController, "show"]).name("me");
    })
    .prefix("/api")
    .middleware([auth])
    .as("api");
  g.where("id", matchers.uuid()).domain(":tenant.example.com").use([logRequests]);
}

export function resources() {
  const res: RouteResource = router.resource("posts", PostController);
  res.only(["index", "show"]);
  res.except(["destroy"]);
  res.apiOnly();
  res.as("articles");
  res.params({ posts: "post" });
  res.use(["store", "update", "destroy"], "auth");
  res.use("*", logRequests);

  router.resource("posts.comments", CommentController); // nested
}

export function constraints() {
  router.get("/users/:id", handler).where("id", /\d+/);
  router.get("/u/:id", handler).where("id", matchers.number());
  router.get("/a/:id", handler).where("id", matchers.uuid());
  router.get("/s/:slug", handler).where("slug", matchers.slug());
  router.get("/x/:id", handler).where("id", { match: /\d+/ });
  router.where("id", matchers.number()); // global
}

export function routeChain() {
  const r: Route = router.get("/users/:id", [UserController, "show"]);
  r.name("users.show");
  r.as("users.show");
  r.middleware([auth]);
  r.use(["auth", "admin"]);
  r.where("id", /\d+/);
  r.domain("blog.example.com");
  const def: RouteDefinition = r.def;
  return def;
}

export function named() {
  const map: Parameters<typeof router.named>[0] = {};
  router.named(map);
  const mw = router.resolveMiddleware("auth");
  return mw;
}

export function inspect() {
  const routes: RouteDefinition[] = router.all();
  for (const def of routes) {
    console.log(def.methods.join("|"), def.path, def.name ?? "");
  }
  const fn = router.resolve([UserController, "show"]);
  return { routes, fn };
}

// matchers stand-alone
export function matcherValues() {
  router.get("/u/:id", handler).where("id", matchers.number());
  return [matchers.number(), matchers.uuid(), matchers.slug(), matchers.alpha()];
}

// Interface / type seams
const aMatcher: Matcher = /\d+/;
const bMatcher: Matcher = "\\d+";
const cMatcher: Matcher = { match: /[a-z]+/ };
const method: Method = "GET";
const methods: Method[] = ["GET", "POST"];
const ref: MiddlewareRef = "auth";
const refFn: MiddlewareRef = rateLimiterMw;
const routeDef: RouteDefinition = {
  methods: ["GET"],
  path: "/",
  handler: (c: Ctx) => c.text("ok"),
  middleware: [],
  wheres: {},
};
const someHandler: RouteHandler = (c: Ctx) => c.json({ ok: true });
export { aMatcher, bMatcher, cMatcher, method, methods, ref, refFn, routeDef, someHandler, admin };
