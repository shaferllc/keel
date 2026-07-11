// Type-check harness for docs/database.md. Every snippet in the reference is
// exercised here against the real exports, so a renamed method or wrong argument
// type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  db,
  setConnection,
  type Connection,
  type WriteResult,
  type Row,
  type Dialect,
  type Operator,
} from "@shaferllc/keel/core";

declare const email: string;
declare const name: string;
declare const now: number;

export async function connect() {
  const d1 = {} as {
    prepare(sql: string): {
      bind(...b: unknown[]): {
        all(): Promise<{ results: Row[]; meta: { changes: number; last_row_id: number } }>;
        run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
      };
    };
  };

  const connection: Connection = {
    select: (sql, bindings) => d1.prepare(sql).bind(...bindings).all().then((r) => r.results),
    write: async (sql, bindings) => {
      const r = await d1.prepare(sql).bind(...bindings).run();
      return { rowsAffected: r.meta.changes, insertId: r.meta.last_row_id };
    },
  };
  setConnection(connection, "sqlite");
  setConnection(connection, "postgres");
}

export async function querying() {
  await db("users").where("active", true).orderBy("name").get();
  await db("users").where("id", 1).first();
  await db("users").where("age", ">", 18).count();
  await db("posts").whereIn("id", [1, 2, 3]).get();
  await db("posts").whereNull("deleted_at").limit(20).offset(40).get();
  await db("orders").select("id", "total").where("status", "paid").orWhere("status", "shipped").get();
}

export async function writing() {
  const id = await db("users").insertGetId({ email, name });
  await db("users").where("id", id).update({ name: "Grace" });
  await db("users").where("id", id).delete();
}

export async function typedRows() {
  type User = {
    id: number;
    email: string;
  };
  const user = await db<User>("users").where("id", 1).first();
  const all = await db<User>("users").get();
  return { user, all };
}

export async function reference() {
  db("users");
  db<{ id: number }>("users");

  db("users").select("id", "email").get();
  db("users").where("active", true);
  db("users").where("age", ">", 18);
  db("users").where("email", "like", "%@example.com");
  db("orders").where("status", "paid").orWhere("status", "shipped").get();
  db("posts").whereIn("id", [1, 2, 3]).get();
  db("posts").whereNull("deleted_at").get();
  db("users").whereNotNull("verified_at").get();
  db("users").orderBy("last_name").orderBy("created_at", "desc").get();
  db("posts").limit(20).offset(40).get();

  const rows = await db("users").where("active", true).get();
  const first = await db("users").where("email", email).first();
  const active = await db("users").where("active", true).count();
  const taken = await db("users").where("email", email).exists();

  const result: WriteResult = await db("users").insert({ email, name });
  const newId = await db("users").insertGetId({ email, name });
  const upd: WriteResult = await db("users").where("id", 1).update({ name: "Grace" });
  await db("sessions").where("expires_at", "<", now).delete();

  return { rows, first, active, taken, result, newId, upd };
}

// Interface / type seams
const mock: Connection = {
  select: async () => [{ id: 1 }],
  write: async (): Promise<WriteResult> => ({ rowsAffected: 1, insertId: 1 }),
};
const dialect: Dialect = "postgres";
const op: Operator = "like";
const row: Row = { id: 1 };
export { mock, dialect, op, row };
