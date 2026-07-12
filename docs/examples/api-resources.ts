// Type-check harness for docs/api-resources.md. Compile-only — never executed.
import { z } from "zod";

import { apiResource, type ApiResourceOptions, type ApiAccess } from "@shaferllc/keel/api";
import { Model, Router, make, type Ctx } from "@shaferllc/keel/core";

class Post extends Model {
  static override table = "posts";
  static override fillable = ["title", "body", "status", "authorId"];
  declare id: number;
  declare title: string;
  declare status: string;
  declare authorId: number;
}

declare function isEditor(c: Ctx): boolean;
declare function currentUserId(c: Ctx): number;

const PostSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  status: z.enum(["draft", "published"]),
});

export function basic() {
  apiResource(make(Router), Post, {
    filter: ["status", "authorId"],
    sort: ["createdAt", "title"],
    body: PostSchema,
    access: { read: true, write: (c) => isEditor(c) },
    scope: (q) => q.where("deleted", false),
  });
}

/** Access is deny-by-default; these are the ways to open a route. */
export function access(): ApiAccess[] {
  return [
    { all: true },
    { read: true }, // list + get
    { write: (c) => isEditor(c) }, // create + update + delete
    { list: true, get: true, create: false, update: false, delete: false },
  ];
}

/** Row-level security: a row outside the scope 404s for read, update and delete. */
export function rowLevelSecurity() {
  apiResource(make(Router), Post, {
    access: { all: true },
    scope: (q, c) => q.where("authorId", currentUserId(c)),
  });
}

export function shapingInputAndOutput() {
  apiResource(make(Router), Post, {
    access: { all: true },
    createBody: PostSchema,
    updateBody: PostSchema.partial(),
    beforeWrite: (data, c, action) => ({
      ...data,
      ...(action === "create" ? { authorId: currentUserId(c) } : {}),
    }),
    transform: (model) => ({ id: (model as Post).id, title: (model as Post).title }),
  });
}

export function everyOption(): ApiResourceOptions {
  return {
    path: "articles",
    name: "articles",
    only: ["list", "read"],
    except: ["delete"],
    filter: ["status"],
    sort: ["title"],
    perPage: 25,
    maxPerPage: 100,
    body: PostSchema,
    createBody: PostSchema,
    updateBody: PostSchema.partial(),
    access: { read: true },
    scope: (q) => q.where("deleted", false),
    transform: (model) => model.toJSON(),
    beforeWrite: (data) => data,
    tags: ["Posts"],
    label: "Post",
  };
}
