// Type-check harness for docs/url-builder.md. Every type-checkable snippet in
// the reference is exercised here against the real exports, so a renamed method
// or wrong argument type fails `npm run typecheck:docs`. Compile-only — never
// executed.
import {
  Router,
  Container,
  matchers,
  type UrlOptions,
  type SignedUrlOptions,
  type Matcher,
} from "@shaferllc/keel/core";

// The router is resolved from the container in a real app; construct it
// directly here (as the test suite does).
const router = new Router(new Container());

// Controllers referenced by the doc's route registrations.
class UserController {}
class FileController {}
class PostController {}
class TeamController {}
class CodeController {}
class XController {}

export function building() {
  router.get("/users/:id", [UserController, "show"]).name("users.show");

  const a: string = router.url("users.show", { id: 42 });
  const b: string = router.url("users.show", { id: 42 }, { qs: { tab: "posts", page: 2 } });

  router.get("/files/:name", [FileController]).name("files.show");
  const c: string = router.url("files.show", { name: "a/b c.txt" });

  return { a, b, c };
}

export function optionalParams() {
  router.get("/posts/:id?", [PostController, "show"]).name("posts.show");
  const withId: string = router.url("posts.show", { id: 7 });
  const without: string = router.url("posts.show", {});
  return { withId, without };
}

export function errors() {
  // Throws at runtime; type-checks fine.
  return router.url("nope");
}

export async function signing() {
  const url: string = await router.signedUrl("download", { id: 7 });
  const expiring: string = await router.signedUrl(
    "download",
    { id: 7 },
    { expiresIn: 3600 },
  );
  const valid: boolean = await router.hasValidSignature();
  return { url, expiring, valid };
}

export function constraints() {
  router.get("/users/:id", [UserController]).where("id", /\d+/);
  router.get("/p/:slug", [PostController]).where("slug", { match: /[a-z0-9-]+/ });

  router.get("/n/:id", [UserController]).where("id", matchers.number());
  router.get("/t/:id", [TeamController]).where("id", matchers.uuid());
  router.get("/s/:slug", [PostController]).where("slug", matchers.slug());
  router.get("/c/:code", [CodeController]).where("code", matchers.alpha());

  // Also reachable off the instance.
  router.get("/i/:id", [XController]).where("id", router.matchers.number());
}

export function typeSeams() {
  const opts: UrlOptions = { qs: { page: 2, tab: "posts" } };
  router.url("users.show", { id: 1 }, opts);

  const signed: SignedUrlOptions = { qs: { plan: "pro" }, expiresIn: 3600 };

  const a: Matcher = /\d+/;
  const b: Matcher = "[0-9]+";
  const c: Matcher = { match: /[a-z-]+/ };
  router.get("/x/:id", [XController]).where("id", a);

  return { opts, signed, a, b, c };
}
