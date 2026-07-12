import type { Ctx } from "@shaferllc/keel/core";
import { auth, view } from "@shaferllc/keel/core";

import Welcome from "../../resources/views/welcome.js";

export class HomeController {
  async index(c: Ctx) {
    return c.html(await view(Welcome, { signedIn: auth().check() }));
  }
}
