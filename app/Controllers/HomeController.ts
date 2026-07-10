import type { Ctx } from "@keel/core";
import { View, config } from "@keel/core";
import type { Container } from "@keel/core";
import { WelcomePage } from "../../resources/views/welcome.js";

/**
 * Controllers are resolved from the container, so they get the app injected
 * and can pull any bound service out of it.
 */
export class HomeController {
  constructor(private app: Container) {}

  index(c: Ctx) {
    return c.json({
      framework: "Keel",
      app: config("app.name"),
      env: config("app.env"),
      message: "⚓ Your house framework is afloat.",
    });
  }

  /** Render a view through the View service. */
  welcome(c: Ctx) {
    const appName = config("app.name", "Keel");
    return this.app.make(View).render(WelcomePage({ appName }));
  }

  show(c: Ctx) {
    return c.json({ id: c.req.param("id") });
  }
}
