import { json, text, param } from "@keel/core";
import { HomeController } from "../app/Controllers/HomeController.js";
/**
 * Register your routes here — closures, [Controller, method] tuples, or static
 * responses. Name them, group them, constrain params, and generate URLs.
 */
export default function routes(router) {
    router.get("/", [HomeController, "index"]).name("home");
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
    // Param constraint — only matches digits.
    router.get("/n/:id", () => json({ id: param("id") })).where("id", /\d+/);
    // Redirect convenience.
    router.on("/home").redirect("/");
    // Render an Inertia page directly from a route.
    router.on("/dashboard").renderInertia("Dashboard", { title: "Welcome" });
    // Group: shared prefix + name prefix → GET /api/status named "api.status".
    router
        .group(() => {
        router.get("/status", json({ up: true })).name("status");
    })
        .prefix("/api")
        .as("api");
    // RESTful resource routes (index + show only) → /widgets, /widgets/:id.
    router.resource("widgets", HomeController).only(["index", "show"]);
    // URL generation from a named route.
    router.get("/link", () => json({ status: router.url("api.status") }));
}
