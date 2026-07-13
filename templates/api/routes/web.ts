import type { Router, Ctx } from "@shaferllc/keel/core";
import { apiResource } from "@shaferllc/keel/api";
import { z } from "zod";

import { Post } from "../app/Models/Post.js";

const PostBody = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
});

export default function routes(router: Router): void {
  router.get("/health", (c: Ctx) => c.json({ ok: true }));

  // Deny-by-default access: reads are open for the demo; writes need an explicit
  // allow. Swap `write: true` for a real check (API key, session, …) in production.
  apiResource(router, Post, {
    filter: ["title"],
    sort: ["title", "created_at", "id"],
    body: PostBody,
    access: { read: true, write: true },
    tags: ["posts"],
  });
}
