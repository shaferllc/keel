import type { Router } from "@keel/core";
import { json, text, param } from "@keel/core";
import { HomeController } from "../app/Controllers/HomeController.js";

/**
 * Register your routes here. Handlers are either a [Controller, method] tuple
 * (resolved from the container) or an inline closure. Inside either, the global
 * helpers (json, text, param, …) reach the request — no `c` needed.
 */
export default function routes(router: Router): void {
  router.get("/", [HomeController, "index"]);

  router.get("/welcome", [HomeController, "welcome"]);

  router.get("/users/:id", [HomeController, "show"]);

  router.post("/users", [HomeController, "store"]);

  router.get("/missing", [HomeController, "missing"]);

  router.get("/boom", [HomeController, "boom"]);

  router.get("/clock", [HomeController, "clock"]);

  // Static response — no closure needed.
  router.get("/ping", json({ pong: true }));

  // Dynamic — a closure, so param() runs per request.
  router.get("/hello/:name", () => text(`Hello, ${param("name")}!`));
}
