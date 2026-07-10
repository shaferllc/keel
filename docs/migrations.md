# Migrations

Version your database schema. A migration is a `{ name, up, down }` object; a
fluent **schema builder** describes tables, and the **migrator** runs them
against your [connection](./database.md), tracking what's applied. The SQL is
dialect-aware (sqlite / mysql / postgres) and the core imports no driver.

## Define migrations

```ts
import type { Migration } from "@shaferllc/keel/core";

export const migrations: Migration[] = [
  {
    name: "01_create_users",
    up: (schema) =>
      schema.createTable("users", (t) => {
        t.id();
        t.string("email").unique();
        t.string("name");
        t.boolean("active").default(true);
        t.timestamps();               // created_at + updated_at
      }),
    down: (schema) => schema.dropTable("users"),
  },
];
```

### Column types

`t.id()` · `t.string(name, length?)` · `t.text(name)` · `t.integer(name)` ·
`t.bigInteger(name)` · `t.boolean(name)` · `t.timestamp(name)` · `t.json(name)` ·
`t.timestamps()`.

Chain modifiers: `.nullable()`, `.unique()`, `.default(value)`.

For anything the builder doesn't cover, `schema.raw(sql)` runs arbitrary SQL.

## Run and roll back

```ts
import { Migrator } from "@shaferllc/keel/core";

const migrator = new Migrator(connection, "postgres");

await migrator.up(migrations);    // runs pending migrations (idempotent)
await migrator.down(migrations);  // rolls back the last batch
await migrator.ran();             // names already applied
```

`up()` records each applied migration in a `migrations` table with a batch
number, so re-running only applies new ones. `down()` reverses the most recent
batch in reverse order, calling each migration's `down()`.

## Wiring a console command

Migrations are usually driven from your app's console. Load your migration files
and call the migrator:

```ts
// bin/console.ts
program.command("migrate").action(async () => {
  const applied = await new Migrator(connection, dialect).up(migrations);
  console.log(applied.length ? `Ran: ${applied.join(", ")}` : "Nothing to migrate.");
});
```

## Dialect notes

The builder emits the right primary-key syntax per dialect —
`SERIAL`/`INTEGER PRIMARY KEY AUTOINCREMENT`/`INT AUTO_INCREMENT` — and maps
`boolean`/`timestamp`/`json` to each dialect's types. Pass the dialect that
matches your connection.
