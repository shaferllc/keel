// Type-check harness for docs/query-builder.md. Compile-only — never executed.
import { db, type Row } from "@shaferllc/keel/core";

declare const email: string;
declare const name: string;
declare const id: number;
declare const now: number;
declare const search: string | undefined;
declare const includeArchived: boolean;
declare const key: string;
declare const value: string;

export async function retrieving() {
  await db("users").get();
  await db("users").where("id", 1).first();
  await db("users").where("id", 1).firstOrFail();
  await db("users").find(1);
  await db("users").where("email", email).sole();
  await db("users").where("id", 1).value("email");
  await db("posts").pluck("title");
  await db("tags").orderBy("name").implode("name", ", ");

  await db("users")
    .orderBy("id")
    .chunk(500, async (rows) => {
      for (const _row of rows) {
        /* process */
      }
    });
}

export async function aggregates() {
  await db("orders").count();
  await db("orders").where("paid", true).sum("total");
  await db("orders").avg("total");
  await db("orders").min("total");
  await db("orders").max("total");
  await db("users").where("email", email).exists();
  await db("users").where("banned", true).doesntExist();
}

export async function selectsAndWheres() {
  db("users").select("id", "email");
  db("users").select("id").addSelect("email");
  db("orders").selectRaw("SUM(total) AS revenue");
  db("users").distinct().select("country");

  db("users").where("votes", 100);
  db("users").where("votes", ">=", 100);
  db("users").where("name", "like", "T%");
  db("users").where("votes", 100).orWhere("name", "John");
  db("users").whereNot("status", "cancelled");
  db("users").whereIn("id", [1, 2, 3]).whereNotIn("id", [4]);
  db("users").whereNull("deleted_at").whereNotNull("email_verified_at");
  db("products").whereBetween("price", [10, 100]).whereNotBetween("stock", [0, 5]);
  db("posts").whereLike("title", "%keel%");
  db("events").whereColumn("updated_at", ">", "created_at");
  db("users").whereRaw("score >= ? AND score <= ?", [10, 90]);

  await db("users")
    .where("active", true)
    .where((q) => q.where("role", "admin").orWhere("role", "owner"))
    .get();
}

export async function orderingJoinsWhen() {
  db("users").orderBy("name").orderByDesc("created_at");
  db("posts").latest();
  db("posts").oldest();
  db("posts").orderByRaw("LENGTH(title) DESC");
  db("users").inRandomOrder();
  db("users").reorder("name");
  db("users").limit(10).offset(20);
  db("users").take(10).skip(20);
  db("users").forPage(3, 15);

  await db("orders")
    .select("user_id")
    .selectRaw("SUM(total) AS spent")
    .groupBy("user_id")
    .having("spent", ">", 1000)
    .get();

  await db("posts")
    .join("users", "posts.user_id", "users.id")
    .leftJoin("images", "images.post_id", "posts.id")
    .select("posts.title", "users.name")
    .get();

  await db("users")
    .when(search, (q, term) => q.whereLike("name", `%${term}%`))
    .unless(includeArchived, (q) => q.whereNull("archived_at"))
    .get();
}

export async function writes() {
  await db("users").insert({ email, name });
  await db("users").insertGetId({ email, name });
  await db("logs").insertOrIgnore({ key, value });
  await db("users").upsert([{ id: 1, name: "Ada" }], ["id"], ["name"]);

  await db("users").where("id", id).update({ name: "Grace" });
  await db("users").updateOrInsert({ email }, { name });
  await db("posts").where("id", id).increment("views");
  await db("posts").where("id", id).decrement("stock", 3, { updated_at: now });
  await db("counters").incrementEach({ hits: 1, misses: 2 });

  await db("sessions").where("expires_at", "<", now).delete();
  await db("cache").truncate();
}

export async function typed() {
  type User = { id: number; email: string };
  const row: User | null = await db<User>("users").where("id", 1).first();
  const rows: User[] = await db<User>("users").get();
  const raw: Row[] = await db("users").get();
  return { row, rows, raw };
}
