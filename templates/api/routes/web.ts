import type { Router, Ctx } from "@shaferllc/keel/core";

import { PostController } from "../app/Controllers/PostController.js";

export default function routes(router: Router): void {
  router.get("/health", (c: Ctx) => c.json({ ok: true }));

  router.get("/posts", [PostController, "index"]).name("posts.index");
  router.post("/posts", [PostController, "store"]).name("posts.store");
  router.get("/posts/:post", [PostController, "show"]).name("posts.show");
  router.delete("/posts/:post", [PostController, "destroy"]).name("posts.destroy");
}
