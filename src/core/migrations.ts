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

/** A foreign-key constraint, built fluently: `foreign("user_id").references("id").on("users")`. */
export class ForeignKeyBuilder {
  private _refTable = "";
  private _refColumn = "id";
  private _onDelete?: string;
  private _onUpdate?: string;

  constructor(private column: string) {}

  references(column: string): this {
    this._refColumn = column;
    return this;
  }
  on(table: string): this {
    this._refTable = table;
    return this;
  }
  onDelete(action: string): this {
    this._onDelete = action;
    return this;
  }
  onUpdate(action: string): this {
    this._onUpdate = action;
    return this;
  }

  toSql(): string {
    let sql = `FOREIGN KEY (${this.column}) REFERENCES ${this._refTable}(${this._refColumn})`;
    if (this._onDelete) sql += ` ON DELETE ${this._onDelete}`;
    if (this._onUpdate) sql += ` ON UPDATE ${this._onUpdate}`;
    return sql;
  }
}

interface IndexDef {
  columns: string[];
  unique: boolean;
  name?: string;
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function indexName(table: string, columns: string[], unique: boolean): string {
  return `${table}_${columns.join("_")}_${unique ? "unique" : "index"}`;
}

/** Column-declaring methods shared by `createTable` and `alterTable` builders. */
abstract class ColumnBag {
  readonly columns: Column[] = [];

  protected add(name: string, type: ColumnType, length?: number): Column {
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
}

export class TableBuilder extends ColumnBag {
  readonly indexes: IndexDef[] = [];
  readonly foreignKeys: ForeignKeyBuilder[] = [];

  /** A (possibly composite) index. */
  index(columns: string | string[], name?: string): this {
    this.indexes.push({ columns: toArray(columns), unique: false, ...(name ? { name } : {}) });
    return this;
  }
  /** A (possibly composite) unique index. */
  uniqueIndex(columns: string | string[], name?: string): this {
    this.indexes.push({ columns: toArray(columns), unique: true, ...(name ? { name } : {}) });
    return this;
  }
  /** A foreign key: `foreign("user_id").references("id").on("users")`. */
  foreign(column: string): ForeignKeyBuilder {
    const fk = new ForeignKeyBuilder(column);
    this.foreignKeys.push(fk);
    return fk;
  }

  /** The `CREATE TABLE` plus any `CREATE INDEX` statements, in order. */
  toStatements(table: string, dialect: Dialect): string[] {
    const parts = [
      ...this.columns.map((c) => c.toSql(dialect)),
      ...this.foreignKeys.map((fk) => fk.toSql()),
    ];
    const create = `CREATE TABLE ${table} (${parts.join(", ")})`;
    return [create, ...this.indexes.map((i) => createIndexSql(table, i))];
  }

  /** @deprecated Use `toStatements`. Kept for callers that build the SQL directly. */
  toCreateSql(table: string, dialect: Dialect): string {
    return this.toStatements(table, dialect)[0]!;
  }
}

function createIndexSql(table: string, index: IndexDef): string {
  const name = index.name ?? indexName(table, index.columns, index.unique);
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${name} ON ${table} (${index.columns.join(", ")})`;
}

/** Alterations to an existing table: add/drop/rename columns, add/drop indexes. */
export class AlterTableBuilder extends ColumnBag {
  private readonly drops: string[] = [];
  private readonly renames: { from: string; to: string }[] = [];
  private readonly addIndexes: IndexDef[] = [];
  private readonly dropIndexes: string[] = [];

  /** Drop a column. */
  dropColumn(name: string): this {
    this.drops.push(name);
    return this;
  }
  /** Rename a column. */
  renameColumn(from: string, to: string): this {
    this.renames.push({ from, to });
    return this;
  }
  index(columns: string | string[], name?: string): this {
    this.addIndexes.push({ columns: toArray(columns), unique: false, ...(name ? { name } : {}) });
    return this;
  }
  uniqueIndex(columns: string | string[], name?: string): this {
    this.addIndexes.push({ columns: toArray(columns), unique: true, ...(name ? { name } : {}) });
    return this;
  }
  dropIndex(name: string): this {
    this.dropIndexes.push(name);
    return this;
  }

  toStatements(table: string, dialect: Dialect): string[] {
    const stmts: string[] = [];
    // Drop indexes first, so a column an index references can then be dropped.
    for (const name of this.dropIndexes) {
      // MySQL drops indexes through ALTER TABLE; sqlite/postgres use DROP INDEX.
      stmts.push(dialect === "mysql" ? `ALTER TABLE ${table} DROP INDEX ${name}` : `DROP INDEX ${name}`);
    }
    for (const col of this.columns) stmts.push(`ALTER TABLE ${table} ADD COLUMN ${col.toSql(dialect)}`);
    for (const { from, to } of this.renames) {
      stmts.push(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
    }
    for (const name of this.drops) stmts.push(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    for (const index of this.addIndexes) stmts.push(createIndexSql(table, index));
    return stmts;
  }
}

export class SchemaBuilder {
  constructor(private conn: Connection, private dialect: Dialect) {}

  async createTable(name: string, build: (table: TableBuilder) => void): Promise<void> {
    const table = new TableBuilder();
    build(table);
    for (const sql of table.toStatements(name, this.dialect)) await this.conn.write(sql, []);
  }

  /** Alter an existing table — add/drop/rename columns, add/drop indexes. */
  async alterTable(name: string, build: (table: AlterTableBuilder) => void): Promise<void> {
    const table = new AlterTableBuilder();
    build(table);
    for (const sql of table.toStatements(name, this.dialect)) await this.conn.write(sql, []);
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
    const rows = (await this.conn.select("SELECT name FROM migrations", [])) as { name: string }[];
    return rows.map((r) => String(r.name));
  }

  private async maxBatch(): Promise<number> {
    const rows = (await this.conn.select(
      "SELECT MAX(batch) AS b FROM migrations",
      [],
    )) as { b: number | null }[];
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
    const rows = (await this.conn.select(
      this.ph("SELECT name FROM migrations WHERE batch = ?"),
      [batch],
    )) as { name: string }[];
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
