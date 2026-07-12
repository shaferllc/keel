// Type-check harness for the route-model-binding section of docs/routing.md.
// Compile-only — never executed.
import {
  bindModel,
  bindRoute,
  boundModel,
  boundValue,
  hasBinding,
  clearBindings,
  Model,
  Router,
  make,
  ForbiddenException,
  type Ctx,
  type BindingOptions,
} from "@shaferllc/keel/core";
import type { MiddlewareHandler } from "hono";

class Post extends Model {
  static override table = "posts";
  declare id: number;
  declare slug: string;
  declare authorId: number;
}

interface Tenant {
  id: number;
  name: string;
}

declare const tenants: Map<string, Tenant>;
declare function currentUserId(c: Ctx): number;
declare function edit(c: Ctx): Response;

export function basic() {
  bindModel("post", Post);

  make(Router).get("/posts/:post", (c) => {
    const post: Post = boundModel(Post); // a Post, guaranteed
    return c.json({ id: post.id });
  });
}

export function byAnotherColumn() {
  bindModel("post", Post, { key: "slug" });
}

/** scope is row-level security: a row outside it 404s. */
export function scoped() {
  const options: BindingOptions<Post> = {
    key: "slug",
    scope: (query, c) => query.where("authorId", currentUserId(c)),
    missing: () => new Post({ id: 0 }),
  };
  bindModel("post", Post, options);
}

export function middlewareSeesTheModel() {
  const mustOwn: MiddlewareHandler = async (c, next) => {
    if (boundModel(Post).authorId !== currentUserId(c)) throw new ForbiddenException();
    await next();
  };

  make(Router).get("/posts/:post/edit", edit).middleware(mustOwn);
}

export function anythingAtAll() {
  bindRoute("tenant", (slug) => tenants.get(slug));

  make(Router).get("/t/:tenant", (c) => {
    const tenant = boundValue<Tenant>("tenant");
    return c.json({ name: tenant?.name });
  });
}

export function disambiguate(): [Post, Post] {
  return [boundModel(Post, "post"), boundModel(Post, "original")];
}

export function registry(): boolean {
  clearBindings();
  return hasBinding("post");
}
