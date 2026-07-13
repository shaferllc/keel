// Type-check harness for docs/hono.md. Compile-only — never executed.
import type { Ctx } from "@shaferllc/keel/core";
import { Router, json } from "@shaferllc/keel/core";

export function withContext(router: Router) {
  router.get("/users/:id", async (c: Ctx) => {
    const id = c.req.param("id");
    const q = c.req.query("q");
    const auth = c.req.header("authorization");
    void q;
    void auth;
    return c.json({ id });
  });

  router.get("/ping", (c) => c.text("pong"));
  router.get("/go", (c) => c.redirect("/"));
}

export function ambientHelpers() {
  return json({ ok: true });
}

export function keelContext(c: Ctx) {
  return {
    app: c.get("app"),
    route: c.get("route"),
    subdomains: c.get("subdomains"),
  };
}
