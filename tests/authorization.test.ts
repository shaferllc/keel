import { test } from "node:test";
import assert from "node:assert/strict";

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
} from "../src/core/authorization.js";
import { ForbiddenException } from "../src/core/exceptions.js";

type User = { id: number; admin?: boolean };

class Post {
  constructor(public authorId: number) {}
}

function asUser(user: User | null) {
  setUserResolver(() => user);
}

test("a gate decides an ad-hoc ability for the current user", async () => {
  clearAuthorization();
  asUser({ id: 1 });
  define("update-post", (user, post) => (post as Post).authorId === (user as User).id);

  assert.equal(await can("update-post", new Post(1)), true);
  assert.equal(await can("update-post", new Post(2)), false);
  assert.equal(await cannot("update-post", new Post(2)), true);
});

test("authorize throws a 403 when denied, passes when allowed", async () => {
  clearAuthorization();
  asUser({ id: 1 });
  define("delete-post", (user, post) => (post as Post).authorId === (user as User).id);

  await authorize("delete-post", new Post(1)); // allowed — no throw
  await assert.rejects(
    () => authorize("delete-post", new Post(99)),
    (e) => e instanceof ForbiddenException && (e as ForbiddenException).status === 403,
  );
});

test("policies group abilities per model; can() routes by the argument's class", async () => {
  clearAuthorization();
  asUser({ id: 1 });
  class PostPolicy {
    update(user: User, post: Post) {
      return post.authorId === user.id;
    }
    delete(user: User, post: Post) {
      return Boolean(user.admin) || post.authorId === user.id;
    }
  }
  policy(Post, PostPolicy);

  assert.equal(await can("update", new Post(1)), true);
  assert.equal(await can("update", new Post(2)), false);
  assert.equal(await can("delete", new Post(2)), false); // not author, not admin

  asUser({ id: 5, admin: true });
  assert.equal(await can("delete", new Post(2)), true); // admin
});

test("a before-hook can short-circuit every check (admin bypass)", async () => {
  clearAuthorization();
  asUser({ id: 9, admin: true });
  gateBefore((user) => ((user as User).admin ? true : undefined));
  define("anything", () => false); // would deny…

  assert.equal(await can("anything"), true); // …but the before-hook allows admins
});

test("canFor checks a specific user instead of the current one", async () => {
  clearAuthorization();
  asUser(null); // no current user
  define("edit", (user, id) => (user as User)?.id === id);
  assert.equal(await canFor({ id: 7 }, "edit", 7), true);
  assert.equal(await canFor({ id: 7 }, "edit", 8), false);
});

test("unknown abilities deny by default", async () => {
  clearAuthorization();
  asUser({ id: 1 });
  assert.equal(await can("no-such-ability"), false);
});

test("clearAuthorization resets gates and policies", async () => {
  define("temp", () => true);
  clearAuthorization();
  setUserResolver(() => ({ id: 1 }));
  assert.equal(await can("temp"), false); // gate gone
});
