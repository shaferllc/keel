// Type-check harness for docs/controllers.md. Every type-checkable snippet in
// the guide is exercised here against the real exports, so a renamed method or a
// wrong handler shape fails `npm run typecheck:docs`. Compile-only — never run.
import {
  json,
  param,
  Container,
  type Ctx,
  type RouteHandler,
} from "@shaferllc/keel/core";

// A stand-in service the DI example resolves.
class Mailer {
  send() {}
}

// --- Basic controller: methods are actions, take Ctx or nothing ---
export class PostController {
  index() {
    return json({ posts: [] });
  }

  // Take the context explicitly…
  show(c: Ctx) {
    return c.json({ id: c.req.param("id") });
  }

  // …or lean on the ambient helpers and drop the argument.
  edit() {
    return json({ id: param("id") });
  }
}

// --- Dependency injection: constructor receives the container ---
export class UserController {
  constructor(private app: Container) {}

  store() {
    const mailer = this.app.make(Mailer);
    return json({ sent: typeof mailer.send });
  }

  show(c: Ctx) {
    const id = c.req.param("id");
    const q = c.req.query("expand");
    return c.json({ id, expand: q });
  }
}

// --- Single-action controller: define handle() ---
export class PublishPost {
  handle() {
    return json({ published: true });
  }
}

// --- Resource controller: the seven conventional actions ---
export class ResourcePostController {
  index(c: Ctx) { return c.json({ action: "index" }); }
  create(c: Ctx) { return c.json({ action: "create" }); }
  store(c: Ctx) { return c.json({ action: "store" }); }
  show(c: Ctx) { return c.json({ action: "show" }); }
  edit(c: Ctx) { return c.json({ action: "edit" }); }
  update(c: Ctx) { return c.json({ action: "update" }); }
  destroy(c: Ctx) { return c.json({ action: "destroy" }); }
}

// --- Default export, for the lazy-loading snippet ---
export default class ReportController {
  index(c: Ctx) {
    return c.json({ action: "index" });
  }
}

// --- RouteHandler: every arm of the union type-checks ---
export function handlerForms() {
  const closure: RouteHandler = () => json({ ok: true });
  const staticResp: RouteHandler = json({ status: "ok" });
  const action: RouteHandler = [UserController, "show"];
  const single: RouteHandler = [PublishPost];
  const lazy: RouteHandler = [
    () => Promise.resolve({ default: ReportController }),
    "index",
  ];
  return { closure, staticResp, action, single, lazy };
}
