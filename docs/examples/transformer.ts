// Type-check harness for docs/transformers.md. Every type-checkable snippet in
// the guide is exercised here against the real exports, so a renamed method or
// wrong argument type fails `npm run typecheck:docs`. Compile-only — never run.
import {
  Transformer,
  Model,
  auth,
  json,
  type Attributes,
  type DocumentOptions,
  type Ctx,
} from "@shaferllc/keel/core";

class Post extends Model {
  static table = "posts";
  declare id: number;
  declare title: string;
  declare author: User;
}

class User extends Model {
  static table = "users";
  declare id: number;
  declare name: string;
  declare email: string;
  declare created_at: string;
  declare admin: boolean;
  declare role: string;
  declare permissions: string[];
}

class PostTransformer extends Transformer<Post> {
  transform(post: Post): Attributes {
    return { id: post.id, title: post.title };
  }
}

// Defining a transformer
export class BasicUserTransformer extends Transformer<User> {
  transform(user: User): Attributes {
    return {
      id: user.id,
      name: user.name,
      joined: user.created_at,
    };
  }
}

// Constructor context + conditional fields + nesting + relations
export class UserTransformer extends Transformer<User> {
  constructor(private viewerId: string | null) {
    super();
  }

  transform(user: User): Attributes {
    return {
      id: user.id,
      name: user.name,
      email: this.when(String(user.id) === this.viewerId, user.email),
      token: this.when(fresh, () => mintToken(user), null),
      ...this.mergeWhen(user.admin, { role: user.role, permissions: user.permissions }),
      author: new UserTransformer(this.viewerId).item(user),
      posts: this.whenLoaded(user, "posts", new PostTransformer()),
      roles: this.whenLoaded(user, "roles", (roles: { name: string }[]) =>
        roles.map((r) => r.name),
      ),
    };
  }
}

class WrappedUserTransformer extends Transformer<User> {
  wrapKey = "user";
  transform(user: User): Attributes {
    return { id: user.id, name: user.name };
  }
}

declare const user: User;
declare const list: User[];
declare const fresh: boolean;
declare const fetchedAt: string;
declare function mintToken(user: User): string;

// Transforming
export function transforming() {
  const users = new UserTransformer(null);
  json(users.item(user));
  json(users.collection(list));
  json(users.document(list, { meta: { total: list.length } }));
}

// item null passthrough
export function nullable() {
  const out: Attributes | null = new BasicUserTransformer().item(null);
  return out;
}

// Passing viewer context through the constructor
export function withViewer() {
  return json(new UserTransformer(auth().id()).collection(list));
}

// Nesting / relations — load first, then transform
export async function relations() {
  const users = await User.all<User>();
  await User.load(users, "posts");
  return json(new UserTransformer(null).collection(users));
}

// Response documents
export async function documents() {
  const page = await User.all<User>();
  json(
    new UserTransformer(null).document(page, {
      meta: { total: page.length, page: 1 },
    }),
  );

  new WrappedUserTransformer().document(user); // { user: { … } }
  new UserTransformer(null).document(user, { key: null, meta: { fetchedAt } });
  new UserTransformer(null).document(user, { key: "records", meta: { total: 42 } });
}

// In a controller
export class UserController {
  async show(c: Ctx) {
    const found = await User.findOrFail<User>(c.req.param("id"));
    return c.json(new UserTransformer(auth().id()).item(found));
  }

  async index(c: Ctx) {
    const users = await User.all<User>();
    await User.load(users, "posts");
    return c.json(new UserTransformer(auth().id()).document(users));
  }
}

// Types
const options: DocumentOptions = { key: "records", meta: { total: 42 } };
const shape: Attributes = { id: 1, name: "Ada" };
export { options, shape };
