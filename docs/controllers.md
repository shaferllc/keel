# Controllers

Controllers are plain classes in `app/Controllers/`. Each public method is an
action bound to a route. They're resolved from the [container](./container.md),
so they get dependency injection and a fresh instance per request.

```ts
import type { Ctx } from "@shaferllc/keel/core";
import { json, param } from "@shaferllc/keel/core";

export class PostController {
  index() {
    return json({ posts: [] });
  }

  show() {
    return json({ id: param("id") });
  }
}
```

Bind actions in your routes with a `[Controller, method]` tuple:

```ts
router.get("/posts", [PostController, "index"]);
router.get("/posts/:id", [PostController, "show"]);
```

## Dependency injection

A controller's constructor receives the container, so it can resolve anything:

```ts
import type { Container, Ctx } from "@shaferllc/keel/core";
import { Mailer } from "../Services/Mailer.js";

export class UserController {
  constructor(private app: Container) {}

  store() {
    const mailer = this.app.make(Mailer);
    // …
  }
}
```

## Single-action controllers

For a controller that does one thing, define a `handle` method and reference the
class with no method name:

```ts
export class PublishPost {
  handle() {
    return json({ published: true });
  }
}

router.post("/posts/:id/publish", [PublishPost]); // calls handle()
```

## Lazy-loaded controllers

Pass a `() => import(...)` loader instead of the class, and the controller is
only imported when its route is first hit — handy for large apps and cold
starts:

```ts
router.get("/reports", [() => import("../Controllers/ReportController.js"), "index"]);
```

The loader may resolve to a default export or the class itself.

## Resource controllers

Generate a RESTful controller with all seven actions:

```bash
npm run keel make:controller Post --resource
```

Then wire the whole set up in one line (see [Routing → Resource routes](./routing.md#resource-routes)):

```ts
router.resource("posts", PostController);
router.resource("posts.comments", CommentController); // nested
router.resource("posts", PostController)
  .apiOnly()
  .as("articles")
  .params({ posts: "post" })
  .use(["store", "update", "destroy"], auth);
```
