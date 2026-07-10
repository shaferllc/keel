import type { Ctx } from "@keel/core";
import { config, view, NotFoundException } from "@keel/core";
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

  show(c: Ctx) {
    return c.json({ id: c.req.param("id") });
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
