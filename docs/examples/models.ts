// Type-check harness for docs/models.md. Every type-checkable snippet in the
// guide and its API reference is exercised here against the real exports, so a
// renamed method or wrong argument type fails `npm run typecheck:docs`.
// Compile-only — never executed.
import {
  Model,
  Relation,
  HasOne,
  HasMany,
  BelongsTo,
  BelongsToMany,
  setConnection,
  json,
  type Connection,
  type Row,
  type CastType,
  type Casts,
} from "@shaferllc/keel/core";

declare const email: string;
declare const roleId: number;

/* ------------------------------- define models ------------------------------ */

export class User extends Model {
  static table = "users";
  static primaryKey = "id"; // default

  declare id: number;
  declare email: string;
  declare name: string;

  posts() {
    return this.hasMany(Post);
  }
  profile() {
    return this.hasOne(Profile);
  }
  roles() {
    return this.belongsToMany(Role);
  }
}

export class Post extends Model {
  static table = "posts";
  static fillable = ["title", "body"];
  static casts = {
    published: "boolean", // 1/0        <-> true/false
    views: "int", // "10"       ->  10
    meta: "json", // '{"a":1}'  <-> { a: 1 }   (also "array")
    posted_at: "date", // ISO string <-> Date
  } as const;

  declare id: number;
  declare title: string;
  declare published: boolean;
  declare meta: Record<string, unknown>;

  author() {
    return this.belongsTo(User);
  }
}

export class Profile extends Model {
  static table = "profiles";
  declare id: number;
}

export class Role extends Model {
  static table = "roles";
  declare id: number;
}

/* -------------------------------- connection -------------------------------- */

export function connect() {
  // The mock uses `as Connection` because `select` is declared generic — a
  // concrete implementation returns `Row[]`, which the compiler can't match to
  // an arbitrary `T` without the cast.
  const connection = {
    select: async () => [] as Row[],
    write: async () => ({ rowsAffected: 1, insertId: 1 }),
  } as Connection;
  setConnection(connection, "sqlite");
}

/* --------------------------------- reading ---------------------------------- */

export async function reading() {
  const all = await User.all();
  const one = await User.find(1);
  const orFail = await User.findOrFail(1);
  const firstOne = await User.first();
  const active = await User.where("active", true);
  const rich = await User.query().where("age", ">", 18).orderBy("name").limit(10).get();
  return { all, one, orFail, firstOne, active, rich };
}

/* --------------------------------- writing ---------------------------------- */

export async function writing() {
  const user = await User.create({ email: "a@b.com", name: "Ada" });

  user.name = "Grace";
  await user.save();

  const draft = new User({ email: "new@x.com" });
  await draft.save();
  draft.id;

  await user.delete();
}

/* -------------------------------- attribute casts --------------------------- */

export async function casts() {
  const post = await Post.find(1);
  post?.published; // real boolean
  post?.meta; // real object
  if (post) {
    post.published = false;
    await post.save();
  }
}

/* ------------------------------- mass assignment ---------------------------- */

export async function massAssignment(request: { all(): Row }) {
  class Article extends Model {
    static table = "articles";
    static guarded = ["is_admin"];
    declare title: string;
  }

  await Post.create({ title: "Hi", is_admin: true }); // is_admin dropped
  const post = new Post();
  post.fill(request.all()); // safe from over-posting
  post.forceFill({ is_admin: true }); // explicit bypass

  const article = new Article();
  article.fill(request.all());
}

/* --------------------------------- serializing ------------------------------ */

export async function serializing(user: User) {
  user.toJSON();
  json(user);
  user.fill({ name: "X" });
}

/* -------------------------------- relationships ----------------------------- */

export async function relationships(user: User, post: Post) {
  const posts = await user.posts(); // Post[]
  const author = await post.author(); // User | null

  const recent = await user.posts().query().orderBy("created_at", "desc").limit(5).get();
  return { posts, author, recent };
}

/* -------------------------------- eager loading ----------------------------- */

export async function eagerLoading() {
  const users = await User.all();
  await User.load(users, "posts", "roles");

  const loaded = users[0]?.getRelation<Post[]>("posts");
  users[0]?.toJSON();
  return { loaded };
}

/* --------------------------------- many-to-many ----------------------------- */

export async function manyToMany(user: User) {
  await user.roles().attach(roleId);
  await user.roles().attach(roleId, { assigned_at: "now" });
  await user.roles().detach(roleId);
  await user.roles().detach();
  await user.roles().sync([1, 2, 3]);
}

/* -------------------------------- override keys ----------------------------- */

export function overrideKeys(user: User, post: Post) {
  const a: HasMany<Post> = user.hasMany(Post, "authored_by", "id");
  const b: BelongsTo<User> = post.belongsTo(User, "owner_id", "id");
  const c: BelongsToMany<Role> = user.belongsToMany(Role, "user_roles", "user_id", "role_id");
  const d: HasOne<Profile> = user.hasOne(Profile, "user_id", "id");
  return { a, b, c, d };
}

/* --------------------------- relation base / subclasses --------------------- */

export async function relationSurface(user: User) {
  const rel: HasMany<Post> = user.posts();
  const base: Relation<Post, Post[]> = rel;
  base.query();
  const viaGet = await base.get();
  const viaAwait = await base; // PromiseLike — then() resolves to the result
  rel.query();

  const one: HasOne<Profile> = user.hasOne(Profile);
  const oneResult = await one.get(); // Profile | null
  return { viaGet, viaAwait, oneResult };
}

/* --------------------------- static configuration --------------------------- */

export function configuration() {
  User.table;
  User.primaryKey;
  Post.fillable;
  Post.guarded;
  Post.casts;
  Post.timestamps;
  Post.createdAtColumn;
  Post.updatedAtColumn;
  Post.query();
}

export async function ormMaturity() {
  const page = await User.paginate(2, 15); // Paginated<User>
  const users: User[] = page.data;
  const meta = { total: page.total, currentPage: page.currentPage, lastPage: page.lastPage };

  const tag = await User.firstOrCreate({ email: "a@b.com" }, { name: "Ada" });
  const sub = await User.updateOrCreate({ email: "a@b.com" }, { name: "Grace" });

  await tag.update({ name: "Ada L." });
  await sub.refresh();
  return { users, meta, tag, sub };
}

/* ---------------------------- interface / type seams ------------------------ */

const castType: CastType = "boolean";
const castMap: Casts = { published: "boolean", views: "int", meta: "json" };
export { castType, castMap };
