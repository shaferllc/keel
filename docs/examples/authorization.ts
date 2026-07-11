// Type-check harness for docs/authorization.md. Compile-only — never executed.
import {
  define,
  policy,
  gateBefore,
  setUserResolver,
  clearAuthorization,
  can,
  cannot,
  canFor,
  authorize,
  authorizeFor,
  param,
  type GateCallback,
  type BeforeCallback,
} from "@shaferllc/keel/core";

type User = { id: number; role?: string; admin?: boolean };
class Post {
  constructor(
    public authorId: number,
    public published = false,
  ) {}
}
declare const post: Post;
declare const otherUser: User;

export function gates() {
  define("update-post", (user, p) => (p as Post).authorId === (user as User).id);
  define("access-admin", (user) => (user as User).role === "admin");
}

export async function checks() {
  if (await can("update-post", post)) {
    // …
  }
  const no: boolean = await cannot("update-post", post);
  await authorize("update-post", post);
  return no;
}

export function policies() {
  class PostPolicy {
    view(user: User, p: Post) {
      return p.published || p.authorId === user.id;
    }
    update(user: User, p: Post) {
      return p.authorId === user.id;
    }
    delete(user: User, p: Post) {
      return Boolean(user.admin) || p.authorId === user.id;
    }
  }
  policy(Post, PostPolicy);
}

export function beforeHook() {
  gateBefore((user) => ((user as User).role === "superadmin" ? true : undefined));
}

export async function forUser() {
  await canFor(otherUser, "update-post", post);
  await authorizeFor(otherUser, "update-post", post);
}

export function resolver() {
  setUserResolver(() => otherUser);
  clearAuthorization();
}

export async function inController() {
  void param("id");
  await authorize("update", post);
}

// The type seams
const gate: GateCallback = (user, ...args) => Boolean(user) && args.length >= 0;
const before: BeforeCallback = (user) => (user ? undefined : false);
export { gate, before };
