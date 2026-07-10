import type { Router, Ctx } from "@keel/core";
import { HomeController } from "../app/Controllers/HomeController.js";

/**
 * Register your routes here. Handlers are either a [Controller, method] tuple
 * (resolved from the container) or an inline closure.
 */
export default function routes(router: Router): void {
  router.get("/", [HomeController, "index"]);

  router.get("/welcome", [HomeController, "welcome"]);

  router.get("/users/:id", [HomeController, "show"]);

  router.get("/missing", [HomeController, "missing"]);

  router.get("/boom", [HomeController, "boom"]);

  router.get("/ping", (c: Ctx) => c.json({ pong: true }));

  router.get("/hello/:name", (c: Ctx) =>
    c.text(`Hello, ${c.req.param("name")}!`),
  );
}
