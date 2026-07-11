// Type-check harness for docs/transformers.md. Exercises every type-checkable
// snippet against the real exports so a renamed method or wrong signature fails
// `npm run typecheck:docs`. Compile-only — never executed.
import {
  Transformer,
  json,
  type Attributes,
  type DocumentOptions,
} from "@shaferllc/keel/core";

type User = { id: number; name: string; email: string; role: string; admin: boolean };
type Post = { id: number; title: string };

declare const isSelf: boolean;
declare const isAdmin: boolean;
declare const fresh: boolean;
declare function mint(): string;

class PostTransformer extends Transformer<Post> {
  transform(post: Post): Attributes {
    return { id: post.id, title: post.title };
  }
}

class UserTransformer extends Transformer<User> {
  transform(user: User): Attributes {
    return {
      id: user.id,
      name: user.name,
      email: this.when(isSelf, user.email), // key vanishes for others
      token: this.when(fresh, () => mint(), null), // explicit fallback
      ...this.mergeWhen(isAdmin, { role: user.role }),
      posts: this.whenLoaded(user, "posts", new PostTransformer()),
      roles: this.whenLoaded(user, "roles", (rs: { name: string }[]) => rs.map((r) => r.name)),
    };
  }
}

export function usage(user: User, users: User[]) {
  const one: Attributes | null = new UserTransformer().item(user);
  const many: Attributes[] = new UserTransformer().collection(users);
  const wrapped: Attributes = new UserTransformer().document(users, {
    meta: { total: users.length },
  });
  const opts: DocumentOptions = { key: "data", meta: { page: 1 } };
  const custom: Attributes = new UserTransformer().document(user, opts);
  const unwrapped: Attributes = new UserTransformer().document(user, { key: null });
  return [json(one), json(many), json(wrapped), json(custom), json(unwrapped)];
}
