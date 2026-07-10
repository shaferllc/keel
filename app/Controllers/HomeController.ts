import type { Ctx } from "@keel/core";
import { config, view, json, param, make, validate, NotFoundException } from "@keel/core";
import { z } from "zod";
import { WelcomePage } from "../../resources/views/welcome.js";

const NewUser = z.object({
  email: z.string().email(),
  age: z.number().min(18),
});

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

  // validate() parses the JSON body; invalid input -> automatic 422.
  async store() {
    const data = await validate(NewUser); // { email: string; age: number }
    return json({ created: data.email, age: data.age }, 201);
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
