import type { Router, Ctx } from "@shaferllc/keel/core";

import { HomeController } from "../app/Controllers/HomeController.js";

/**
 * Handlers are a [Controller, method] tuple (resolved from the container) or an
 * inline closure.
 */
export default function routes(router: Router): void {
  router.get("/", [HomeController, "index"]);
  router.get("/welcome", [HomeController, "welcome"]);
  router.get("/hello/:name", (c: Ctx) => c.text(`Hello, ${c.req.param("name")}!`));
}
