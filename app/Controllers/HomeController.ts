import type { Ctx } from "@keel/core";
import { config, view, json, param, make, NotFoundException } from "@keel/core";
import { WelcomePage } from "../../resources/views/welcome.js";

export class HomeController {
  index(c: Ctx) {
    return c.json({
      framework: "Keel",
      app: config("app.name"),
      env: config("app.env"),
      message: "⚓ Your house framework is afloat.",
    });
  }

  /** Render a view in one call. */
  welcome(c: Ctx) {
    return view(WelcomePage, { appName: config("app.name", "Keel") });
  }

  // No `c` needed — the request helpers reach it for you.
  show() {
    return json({ id: param("id") });
  }

  // make() resolves the "clock" binding registered in AppServiceProvider.
  clock() {
    return json({ now: make<string>("clock") });
  }

  /** Throws a semantic 404. */
  missing(c: Ctx): never {
    throw new NotFoundException("Widget not found");
  }

  /** Throws an unexpected error (500). */
  boom(c: Ctx): never {
    throw new Error("Something went wrong in the engine room");
  }
}
