import type { Ctx } from "@keel/core";
import { Application } from "@keel/core";
import type { Container } from "@keel/core";

/**
 * Controllers are resolved from the container, so they get the app injected
 * and can pull any bound service out of it.
 */
export class HomeController {
  constructor(private app: Container) {}

  index(c: Ctx) {
    const config = this.app.make(Application).config();
    return c.json({
      framework: "Keel",
      app: config.get("app.name"),
      env: config.get("app.env"),
      message: "⚓ Your house framework is afloat.",
    });
  }

  show(c: Ctx) {
    return c.json({ id: c.req.param("id") });
  }
}
