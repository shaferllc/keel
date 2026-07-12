import type { Ctx } from "@shaferllc/keel/core";
import { validate } from "@shaferllc/keel/core";
import { z } from "zod";

import { Post } from "../Models/Post.js";

/** Keel doesn't ship a validator — anything with `safeParse` works. */
const NewPost = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
});

export class PostController {
  async index(c: Ctx) {
    return c.json(await Post.all());
  }

  async show(c: Ctx) {
    // Throws a 404 on its own, so there's no null check to forget.
    const post = await Post.findOrFail(Number(c.req.param("post")));
    return c.json(post);
  }

  async store(c: Ctx) {
    // A failed validation is a 422 with the field errors — you don't handle it here.
    const data = await validate(NewPost, await c.req.json());

    return c.json(await Post.create(data), 201);
  }

  async destroy(c: Ctx) {
    const post = await Post.findOrFail(Number(c.req.param("post")));
    await post.delete();

    return c.body(null, 204);
  }
}
