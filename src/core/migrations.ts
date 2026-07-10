/**
 * Schema builder + migrator. Define migrations as `{ name, up, down }`, describe
 * tables with a fluent schema builder, and run them through your registered
 * connection. Dialect-aware SQL (sqlite / mysql / postgres), edge-safe.
 *
 *   const migrations: Migration[] = [{
 *     name: "01_create_users",
 *     up: (s) => s.createTable("users", (t) => {
 *       t.id();
 *       t.string("email").unique();
 *       t.timestamps();
 *     }),
 *     down: (s) => s.dropTable("users"),
 *   }];
 *
 *   await new Migrator(connection, "postgres").up(migrations);
 */

import type { Connection, Dialect } from "./database.js";

type ColumnType =
  | "id"
  | "string"
  | "text"
  | "integer"
  | "bigInteger"
  | "boolean"
  | "timestamp"
  | "json";

function sqlType(type: ColumnType, dialect: Dialect, length?: number): string {
  switch (type) {
    case "id":
      return dialect === "postgres"
        ? "SERIAL PRIMARY KEY"
        : dialect === "mysql"
          ? "INT AUTO_INCREMENT PRIMARY KEY"
          : "INTEGER PRIMARY KEY AUTOINCREMENT";
    case "string":
      return `VARCHAR(${length ?? 255})`;
    case "text":
      return "TEXT";
    case "integer":
      return "INTEGER";
    case "bigInteger":
      return "BIGINT";
    case "boolean":
      return dialect === "sqlite" ? "INTEGER" : "BOOLEAN";
    case "timestamp":
      return dialect === "sqlite" ? "DATETIME" : "TIMESTAMP";
    case "json":
      return dialect === "postgres" ? "JSONB" : "TEXT";
  }
}

export class Column {
  private _nullable = false;
  private _unique = false;
  private _default: unknown;
  private hasDefault = false;

  constructor(
    private column: string,
    private type: ColumnType,
    private length?: number,
  ) {}

  nullable(): this {
    this._nullable = true;
    return this;
  }
  unique(): this {
    this._unique = true;
    return this;
  }
  default(value: unknown): this {
    this._default = value;
    this.hasDefault = true;
    return this;
  }

  toSql(dialect: Dialect): string {
    let sql = `${this.column} ${sqlType(this.type, dialect, this.length)}`;
    if (this.type !== "id") sql += this._nullable ? "" : " NOT NULL";
    if (this._unique) sql += " UNIQUE";
    if (this.hasDefault) {
      const v = this._default;
      const rendered =
        typeof v === "string"
          ? `'${v}'`
          : typeof v === "boolean"
            ? dialect === "sqlite"
              ? v
                ? "1"
                : "0"
              : String(v)
            : String(v);
      sql += ` DEFAULT ${rendered}`;
    }
    return sql;
  }
}

export class TableBuilder {
  readonly columns: Column[] = [];

  private add(name: string, type: ColumnType, length?: number): Column {
    const col = new Column(name, type, length);
    this.columns.push(col);
    return col;
  }

  id(name = "id"): Column {
    return this.add(name, "id");
  }
  string(name: string, length = 255): Column {
    return this.add(name, "string", length);
  }
  text(name: string): Column {
    return this.add(name, "text");
  }
  integer(name: string): Column {
    return this.add(name, "integer");
  }
  bigInteger(name: string): Column {
    return this.add(name, "bigInteger");
  }
  boolean(name: string): Column {
    return this.add(name, "boolean");
  }
  timestamp(name: string): Column {
    return this.add(name, "timestamp");
  }
  json(name: string): Column {
    return this.add(name, "json");
  }
  /** Adds nullable created_at + updated_at columns. */
  timestamps(): void {
    this.timestamp("created_at").nullable();
    this.timestamp("updated_at").nullable();
  }

  toCreateSql(table: string, dialect: Dialect): string {
    return `CREATE TABLE ${table} (${this.columns.map((c) => c.toSql(dialect)).join(", ")})`;
  }
}

export class SchemaBuilder {
  constructor(private conn: Connection, private dialect: Dialect) {}

  async createTable(name: string, build: (table: TableBuilder) => void): Promise<void> {
    const table = new TableBuilder();
    build(table);
    await this.conn.write(table.toCreateSql(name, this.dialect), []);
  }

  async dropTable(name: string): Promise<void> {
    await this.conn.write(`DROP TABLE IF EXISTS ${name}`, []);
  }

  async raw(sql: string, bindings: unknown[] = []): Promise<void> {
    await this.conn.write(sql, bindings);
  }
}

export interface Migration {
  name: string;
  up(schema: SchemaBuilder): void | Promise<void>;
  down(schema: SchemaBuilder): void | Promise<void>;
}

export class Migrator {
  constructor(private conn: Connection, private dialect: Dialect = "sqlite") {}

  private ph(sql: string): string {
    if (this.dialect !== "postgres") return sql;
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  private async ensure(): Promise<void> {
    await this.conn.write(
      "CREATE TABLE IF NOT EXISTS migrations (name VARCHAR(255) PRIMARY KEY, batch INTEGER NOT NULL)",
      [],
    );
  }

  /** Names of migrations already applied. */
  async ran(): Promise<string[]> {
    await this.ensure();
    const rows = await this.conn.select<{ name: string }>("SELECT name FROM migrations", []);
    return rows.map((r) => String(r.name));
  }

  private async maxBatch(): Promise<number> {
    const rows = await this.conn.select<{ b: number | null }>(
      "SELECT MAX(batch) AS b FROM migrations",
      [],
    );
    return Number(rows[0]?.b ?? 0);
  }

  /** Run all pending migrations. Returns the names applied. */
  async up(migrations: Migration[]): Promise<string[]> {
    const ran = await this.ran();
    const batch = (await this.maxBatch()) + 1;
    const schema = new SchemaBuilder(this.conn, this.dialect);
    const applied: string[] = [];
    for (const m of migrations) {
      if (ran.includes(m.name)) continue;
      await m.up(schema);
      await this.conn.write(this.ph("INSERT INTO migrations (name, batch) VALUES (?, ?)"), [
        m.name,
        batch,
      ]);
      applied.push(m.name);
    }
    return applied;
  }

  /** Roll back the most recent batch. Returns the names rolled back. */
  async down(migrations: Migration[]): Promise<string[]> {
    await this.ensure();
    const batch = await this.maxBatch();
    if (!batch) return [];
    const rows = await this.conn.select<{ name: string }>(
      this.ph("SELECT name FROM migrations WHERE batch = ?"),
      [batch],
    );
    const schema = new SchemaBuilder(this.conn, this.dialect);
    const rolled: string[] = [];
    for (const name of rows.map((r) => String(r.name)).reverse()) {
      const migration = migrations.find((m) => m.name === name);
      if (migration) await migration.down(schema);
      await this.conn.write(this.ph("DELETE FROM migrations WHERE name = ?"), [name]);
      rolled.push(name);
    }
    return rolled;
  }
}
