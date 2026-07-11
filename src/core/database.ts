/**
 * A small, driver-agnostic query builder. It generates parameterized SQL and
 * runs it through a `Connection` you provide — so it works with any driver:
 * Cloudflare D1, Neon/Postgres, PlanetScale, Turso/libSQL, better-sqlite3, pg.
 * The core stays edge-safe because Keel never imports a database driver.
 *
 *   setConnection(myConnection, "postgres");
 *   const active = await db("users").where("active", true).orderBy("name").get();
 *   const user = await db("users").where("id", 1).first();
 *   await db("users").insert({ email });
 */

export type Row = Record<string, unknown>;

export interface WriteResult {
  rowsAffected: number;
  insertId?: number | string;
}

/** A page of results plus pagination metadata, returned by `paginate()`. */
export interface Paginated<T> {
  data: T[];
  total: number;
  perPage: number;
  currentPage: number;
  lastPage: number;
}

/** The bridge to your database driver. */
export interface Connection {
  /** Run a SELECT (or any row-returning query) and return the rows. */
  select(sql: string, bindings: unknown[]): Promise<Row[]>;
  /** Run an INSERT/UPDATE/DELETE and return write metadata. */
  write(sql: string, bindings: unknown[]): Promise<WriteResult>;
}

export type Dialect = "sqlite" | "mysql" | "postgres";
export type Operator = "=" | "!=" | "<" | "<=" | ">" | ">=" | "like";

let connection: Connection | undefined;
let dialect: Dialect = "sqlite";

/** Register the database connection (and dialect) used by `db()`. */
export function setConnection(conn: Connection, driverDialect: Dialect = "sqlite"): void {
  connection = conn;
  dialect = driverDialect;
}

function conn(): Connection {
  if (!connection) throw new Error("No database connection. Call setConnection(conn, dialect).");
  return connection;
}

/** Render `?` placeholders for the active dialect (Postgres uses $1, $2, …). */
function placeholders(sql: string): string {
  if (dialect !== "postgres") return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

interface Where {
  boolean: "AND" | "OR";
  sql: string;
  bindings: unknown[];
}

export class QueryBuilder<T extends Row = Row> {
  private wheres: Where[] = [];
  private orders: string[] = [];
  private columns = "*";
  private _limit?: number;
  private _offset?: number;

  constructor(private table: string) {}

  select(...columns: string[]): this {
    this.columns = columns.length ? columns.join(", ") : "*";
    return this;
  }

  where(column: string, value: unknown): this;
  where(column: string, operator: Operator, value: unknown): this;
  where(column: string, opOrValue: unknown, value?: unknown): this {
    const [op, val] = value === undefined ? ["=", opOrValue] : [opOrValue, value];
    this.wheres.push({ boolean: "AND", sql: `${column} ${op} ?`, bindings: [val] });
    return this;
  }

  orWhere(column: string, value: unknown): this;
  orWhere(column: string, operator: Operator, value: unknown): this;
  orWhere(column: string, opOrValue: unknown, value?: unknown): this {
    const [op, val] = value === undefined ? ["=", opOrValue] : [opOrValue, value];
    this.wheres.push({ boolean: "OR", sql: `${column} ${op} ?`, bindings: [val] });
    return this;
  }

  whereIn(column: string, values: unknown[]): this {
    const marks = values.map(() => "?").join(", ");
    this.wheres.push({ boolean: "AND", sql: `${column} IN (${marks})`, bindings: values });
    return this;
  }

  whereNull(column: string): this {
    this.wheres.push({ boolean: "AND", sql: `${column} IS NULL`, bindings: [] });
    return this;
  }
  whereNotNull(column: string): this {
    this.wheres.push({ boolean: "AND", sql: `${column} IS NOT NULL`, bindings: [] });
    return this;
  }

  whereNotIn(column: string, values: unknown[]): this {
    const marks = values.map(() => "?").join(", ");
    this.wheres.push({ boolean: "AND", sql: `${column} NOT IN (${marks})`, bindings: values });
    return this;
  }

  whereBetween(column: string, [min, max]: [unknown, unknown]): this {
    this.wheres.push({ boolean: "AND", sql: `${column} BETWEEN ? AND ?`, bindings: [min, max] });
    return this;
  }

  whereLike(column: string, pattern: string): this {
    this.wheres.push({ boolean: "AND", sql: `${column} LIKE ?`, bindings: [pattern] });
    return this;
  }

  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    this.orders.push(`${column} ${direction.toUpperCase()}`);
    return this;
  }

  /** Newest-first / oldest-first by a timestamp column (default `created_at`). */
  latest(column = "created_at"): this {
    return this.orderBy(column, "desc");
  }
  oldest(column = "created_at"): this {
    return this.orderBy(column, "asc");
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  private whereClause(): { sql: string; bindings: unknown[] } {
    if (!this.wheres.length) return { sql: "", bindings: [] };
    const sql =
      " WHERE " +
      this.wheres.map((w, i) => (i === 0 ? "" : `${w.boolean} `) + w.sql).join(" ");
    return { sql, bindings: this.wheres.flatMap((w) => w.bindings) };
  }

  /* ------------------------------- reads ------------------------------- */

  async get(): Promise<T[]> {
    const where = this.whereClause();
    let sql = `SELECT ${this.columns} FROM ${this.table}${where.sql}`;
    if (this.orders.length) sql += ` ORDER BY ${this.orders.join(", ")}`;
    if (this._limit != null) sql += ` LIMIT ${this._limit}`;
    if (this._offset != null) sql += ` OFFSET ${this._offset}`;
    return (await conn().select(placeholders(sql), where.bindings)) as T[];
  }

  async first(): Promise<T | null> {
    this._limit = 1;
    const rows = await this.get();
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    const where = this.whereClause();
    const rows = (await conn().select(
      placeholders(`SELECT COUNT(*) AS count FROM ${this.table}${where.sql}`),
      where.bindings,
    )) as { count: number }[];
    return Number(rows[0]?.count ?? 0);
  }

  async exists(): Promise<boolean> {
    return (await this.count()) > 0;
  }

  private async aggregate(fn: string, column: string): Promise<number> {
    const where = this.whereClause();
    const rows = (await conn().select(
      placeholders(`SELECT ${fn}(${column}) AS agg FROM ${this.table}${where.sql}`),
      where.bindings,
    )) as { agg: number | null }[];
    return Number(rows[0]?.agg ?? 0);
  }

  sum(column: string): Promise<number> {
    return this.aggregate("SUM", column);
  }
  avg(column: string): Promise<number> {
    return this.aggregate("AVG", column);
  }
  min(column: string): Promise<number> {
    return this.aggregate("MIN", column);
  }
  max(column: string): Promise<number> {
    return this.aggregate("MAX", column);
  }

  /** The value of a single column from the first matching row (or null). */
  async value<V = unknown>(column: string): Promise<V | null> {
    this.columns = column;
    const row = await this.first();
    return row ? ((row as Row)[column] as V) : null;
  }

  /** An array of a single column across all matching rows. */
  async pluck<V = unknown>(column: string): Promise<V[]> {
    this.columns = column;
    const rows = await this.get();
    return rows.map((row) => (row as Row)[column] as V);
  }

  /** A page of results plus pagination metadata. */
  async paginate(page = 1, perPage = 15): Promise<Paginated<T>> {
    const total = await this.count();
    this._limit = perPage;
    this._offset = (Math.max(1, page) - 1) * perPage;
    const data = await this.get();
    return {
      data,
      total,
      perPage,
      currentPage: page,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /* ------------------------------- writes ------------------------------ */

  async insert(data: Row): Promise<WriteResult> {
    const keys = Object.keys(data);
    const sql = `INSERT INTO ${this.table} (${keys.join(", ")}) VALUES (${keys
      .map(() => "?")
      .join(", ")})`;
    return conn().write(placeholders(sql), Object.values(data));
  }

  async insertGetId(data: Row): Promise<number | string | undefined> {
    return (await this.insert(data)).insertId;
  }

  async update(data: Row): Promise<WriteResult> {
    const keys = Object.keys(data);
    const set = keys.map((k) => `${k} = ?`).join(", ");
    const where = this.whereClause();
    return conn().write(placeholders(`UPDATE ${this.table} SET ${set}${where.sql}`), [
      ...Object.values(data),
      ...where.bindings,
    ]);
  }

  async delete(): Promise<WriteResult> {
    const where = this.whereClause();
    return conn().write(placeholders(`DELETE FROM ${this.table}${where.sql}`), where.bindings);
  }
}

/** Start a query against a table. */
export function db<T extends Row = Row>(table: string): QueryBuilder<T> {
  return new QueryBuilder<T>(table);
}
