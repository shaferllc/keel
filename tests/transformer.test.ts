import { test } from "node:test";
import assert from "node:assert/strict";

import { Transformer, type Attributes } from "../src/core/transformer.js";

interface User {
  id: number;
  name: string;
  email: string;
  admin?: boolean;
  posts?: Post[];
}

interface Post {
  id: number;
  title: string;
}

class PostTransformer extends Transformer<Post> {
  transform(post: Post): Attributes {
    return { id: post.id, title: post.title };
  }
}

class UserTransformer extends Transformer<User> {
  constructor(private viewerId = 0) {
    super();
  }
  transform(user: User): Attributes {
    return {
      id: user.id,
      name: user.name,
      email: this.when(user.id === this.viewerId, user.email),
      ...this.mergeWhen(user.admin, { role: "admin" }),
      posts: this.whenLoaded(user, "posts", new PostTransformer()),
    };
  }
}

const ada: User = { id: 1, name: "Ada", email: "ada@x.com" };
const bob: User = { id: 2, name: "Bob", email: "bob@x.com" };

test("item transforms a single value to its API shape", () => {
  assert.deepEqual(new UserTransformer().item(ada), { id: 1, name: "Ada" });
});

test("item passes null and undefined straight through", () => {
  assert.equal(new UserTransformer().item(null), null);
  assert.equal(new UserTransformer().item(undefined), null);
});

test("collection transforms every value", () => {
  assert.deepEqual(new UserTransformer().collection([ada, bob]), [
    { id: 1, name: "Ada" },
    { id: 2, name: "Bob" },
  ]);
});

test("when includes a key on a truthy condition and omits it otherwise", () => {
  // viewer is Ada, so Ada sees her own email; Bob does not.
  assert.deepEqual(new UserTransformer(1).item(ada), {
    id: 1,
    name: "Ada",
    email: "ada@x.com",
  });
  assert.deepEqual(new UserTransformer(1).item(bob), { id: 2, name: "Bob" });
});

test("when uses an explicit fallback instead of omitting", () => {
  class T extends Transformer<{ v: boolean }> {
    transform(x: { v: boolean }): Attributes {
      return { token: this.when(x.v, "yes", null) };
    }
  }
  assert.deepEqual(new T().item({ v: true }), { token: "yes" });
  assert.deepEqual(new T().item({ v: false }), { token: null });
});

test("when defers a thunk until the condition holds", () => {
  let calls = 0;
  class T extends Transformer<boolean> {
    transform(v: boolean): Attributes {
      return { x: this.when(v, () => (calls++, "computed")) };
    }
  }
  new T().item(false);
  assert.equal(calls, 0);
  assert.deepEqual(new T().item(true), { x: "computed" });
  assert.equal(calls, 1);
});

test("mergeWhen spreads keys in only when the condition holds", () => {
  const admin: User = { id: 3, name: "Root", email: "r@x.com", admin: true };
  assert.deepEqual(new UserTransformer().item(admin), {
    id: 3,
    name: "Root",
    role: "admin",
  });
  assert.deepEqual(new UserTransformer().item(ada), { id: 1, name: "Ada" });
});

test("whenLoaded includes a relation through a transformer when eager-loaded", () => {
  const withPosts: User = { ...ada, posts: [{ id: 10, title: "Hi" }] };
  assert.deepEqual(new UserTransformer().item(withPosts), {
    id: 1,
    name: "Ada",
    posts: [{ id: 10, title: "Hi" }],
  });
});

test("whenLoaded omits the relation when it is not loaded", () => {
  assert.deepEqual(new UserTransformer().item(ada), { id: 1, name: "Ada" });
});

test("whenLoaded reads a Keel model relation via getRelation, never a method", () => {
  const store: Record<string, unknown> = { posts: [{ id: 5, title: "Loaded" }] };
  const model = {
    id: 9,
    // a relation *method* must not be mistaken for a loaded value
    comments() {
      return [];
    },
    getRelation(name: string) {
      return store[name];
    },
  };
  class T extends Transformer<typeof model> {
    transform(m: typeof model): Attributes {
      return {
        id: m.id,
        posts: this.whenLoaded(m, "posts", new PostTransformer()),
        comments: this.whenLoaded(m, "comments"),
      };
    }
  }
  assert.deepEqual(new T().item(model), {
    id: 9,
    posts: [{ id: 5, title: "Loaded" }],
    // getRelation("comments") is undefined -> omitted, method never called
  });
});

test("whenLoaded maps a relation through a plain function", () => {
  const withPosts: User = { ...ada, posts: [{ id: 1, title: "A" }, { id: 2, title: "B" }] };
  class T extends Transformer<User> {
    transform(u: User): Attributes {
      return {
        id: u.id,
        titles: this.whenLoaded(u, "posts", (posts: Post[]) => posts.map((p) => p.title)),
      };
    }
  }
  assert.deepEqual(new T().item(withPosts), { id: 1, titles: ["A", "B"] });
});

test("pruning removes omitted keys nested inside objects and arrays", () => {
  class T extends Transformer<{ show: boolean }> {
    transform(x: { show: boolean }): Attributes {
      return {
        nested: { keep: 1, drop: this.when(x.show, "v") },
        list: [{ a: this.when(x.show, 1) }, { a: 2 }],
      };
    }
  }
  assert.deepEqual(new T().item({ show: false }), {
    nested: { keep: 1 },
    list: [{}, { a: 2 }],
  });
});

test("document wraps a collection under data with meta", () => {
  assert.deepEqual(
    new UserTransformer().document([ada, bob], { meta: { total: 2 } }),
    { data: [{ id: 1, name: "Ada" }, { id: 2, name: "Bob" }], total: 2 },
  );
});

test("document wraps a single item under the default key", () => {
  assert.deepEqual(new UserTransformer().document(ada), { data: { id: 1, name: "Ada" } });
});

test("document honors a custom wrap key and per-call key override", () => {
  class Wrapped extends UserTransformer {
    wrapKey = "user";
  }
  assert.deepEqual(new Wrapped().document(ada), { user: { id: 1, name: "Ada" } });
  assert.deepEqual(new UserTransformer().document(ada, { key: "record" }), {
    record: { id: 1, name: "Ada" },
  });
});

test("document with key null merges a single object to the top level", () => {
  assert.deepEqual(
    new UserTransformer().document(ada, { key: null, meta: { fetchedAt: "now" } }),
    { id: 1, name: "Ada", fetchedAt: "now" },
  );
});

test("class instances and dates are left intact, not pruned into", () => {
  const when = new Date("2026-07-10T00:00:00.000Z");
  class T extends Transformer<number> {
    transform(id: number): Attributes {
      return { id, at: when };
    }
  }
  const out = new T().item(5)!;
  assert.equal(out.at, when);
});
