import type { Ctx } from "@shaferllc/keel/core";
import { view } from "@shaferllc/keel/core";

import Welcome from "../../resources/views/welcome.js";

export class HomeController {
  index(c: Ctx) {
    return c.json({ framework: "Keel", kit: "minimal", ok: true });
  }

  async welcome(c: Ctx) {
    return c.html(await view(Welcome, { name: "world" }));
  }
}
