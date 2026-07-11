// Type-check harness for docs/migrations.md. Every type-checkable snippet in the
// guide is exercised here against the real exports, so a renamed method or wrong
// argument type fails `npm run typecheck:docs`. Compile-only — never executed.
import {
  Migrator,
  SchemaBuilder,
  TableBuilder,
  Column,
  type Migration,
  type Connection,
  type Dialect,
} from "@shaferllc/keel/core";

// A mock connection. `as Connection` is needed because `select` is declared
// generic (`select<T = Row>(…): Promise<T[]>`) — see docs/database.md.
const connection = {
  select: async () => [],
  write: async () => ({ rowsAffected: 1, insertId: 1 }),
} as Connection;

export const migrations: Migration[] = [
  {
    name: "01_create_users",
    up: (schema) =>
      schema.createTable("users", (t) => {
        t.id();
        t.string("email").unique();
        t.string("name");
        t.boolean("active").default(true);
        t.timestamps();
      }),
    down: (schema) => schema.dropTable("users"),
  },
];

export async function columnTypes() {
  await new SchemaBuilder(connection, "sqlite").createTable("posts", (t) => {
    t.id();
    t.integer("user_id");
    t.string("slug", 120).unique();
    t.text("body").nullable();
    t.json("meta").nullable();
    t.boolean("published").default(false);
    t.timestamps();
  });
}

export async function defaults(schema: SchemaBuilder) {
  await schema.createTable("accounts", (t) => {
    t.string("role").default("member");
    t.boolean("active").default(true);
    t.integer("retries").default(0);
  });
}

export async function rawExamples(schema: SchemaBuilder) {
  await schema.raw("CREATE INDEX idx_posts_user ON posts (user_id)");
  await schema.raw("UPDATE users SET active = ? WHERE active IS NULL", [true]);
}

export async function runAndRollBack() {
  const migrator = new Migrator(connection, "postgres");

  const applied = await migrator.up(migrations);
  const rolled = await migrator.down(migrations);
  const names = await migrator.ran();

  const pending = migrations.filter((m) => !names.includes(m.name));
  return { applied, rolled, names, pending };
}

export async function migratorDefaults() {
  const migrator = new Migrator(connection); // dialect defaults to "sqlite"
  return migrator.ran();
}

// SchemaBuilder reference
export async function schemaBuilderRef(schema: SchemaBuilder) {
  await schema.createTable("users", (t) => {
    t.id();
    t.string("email").unique();
    t.timestamps();
  });
  await schema.dropTable("users");
  await schema.raw("CREATE INDEX idx ON users (email)");
  await schema.raw("UPDATE users SET active = ? WHERE id = ?", [true, 1]);
}

// TableBuilder reference
export function tableBuilderRef() {
  const t = new TableBuilder();
  t.id();
  t.id("uuid");
  t.string("email");
  t.string("slug", 120);
  t.text("body");
  t.integer("user_id");
  t.bigInteger("view_count");
  t.boolean("active").default(true);
  t.timestamp("published_at").nullable();
  t.json("meta").nullable();
  t.timestamps();
  const cols: Column[] = t.columns;
  const sql: string = t.toCreateSql("users", "postgres");
  return { cols, sql };
}

// Column reference
export function columnRef(t: TableBuilder) {
  t.text("bio").nullable();
  t.string("email").unique();
  t.boolean("active").default(true);
  t.string("role").default("member");
  const fragment: string = new Column("email", "string").unique().toSql("sqlite");
  return fragment;
}

// Migration type seam
export const indexMigration: Migration = {
  name: "03_add_index",
  up: (s) => s.raw("CREATE INDEX idx_users_email ON users (email)"),
  down: (s) => s.raw("DROP INDEX idx_users_email"),
};

const d: Dialect = "mysql";
export { d };
