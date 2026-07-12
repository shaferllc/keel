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

import { instrument, currentRequestId } from "./instrumentation.js";

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

/* ----------------------------- connections ---------------------------- */

/** A registered connection — the driver bridge, its name, and its SQL dialect. */
interface Source {
  name: string;
  conn: Connection;
  dialect: Dialect;
}

/**
 * Run a row-returning query on a source and report it to the instrumentation
 * stream (`db.query`) once it settles. Emitting here — the one place every
 * builder and raw handle funnels through — means a package can watch every query
 * without the query layer knowing anything about it.
 */
async function selectOn(source: Source, sql: string, bindings: unknown[]): Promise<Row[]> {
  const start = Date.now();
  const rows = await source.conn.select(placeholders(sql, source.dialect), bindings);
  reportQuery("select", sql, bindings, source, start);
  return rows;
}

/** Run a write on a source and report it to the instrumentation stream. */
async function writeOn(source: Source, sql: string, bindings: unknown[]): Promise<WriteResult> {
  const start = Date.now();
  const result = await source.conn.write(placeholders(sql, source.dialect), bindings);
  reportQuery("write", sql, bindings, source, start);
  return result;
}

function reportQuery(
  kind: "select" | "write",
  sql: string,
  bindings: unknown[],
  source: Source,
  start: number,
): void {
  const requestId = currentRequestId();
  instrument("db.query", {
    sql,
    bindings,
    durationMs: Date.now() - start,
    connection: source.name,
    kind,
    ...(requestId ? { requestId } : {}),
  });
}

/**
 * The connection registry. An app can talk to several databases at once —
 * register each by name, then route a query with `db(table, name)`, a whole
 * model with `static connection`, or a handle from `connection(name)`. The
 * unnamed default lives under `"default"` so `db(table)` and `setConnection()`
 * keep working unchanged.
 */
const registry = new Map<string, Source>();
let defaultConnection = "default";

/** Register the default connection (and dialect) used by `db()`. */
export function setConnection(conn: Connection, driverDialect: Dialect = "sqlite"): void {
  registry.set("default", { name: "default", conn, dialect: driverDialect });
  defaultConnection = "default";
}

/**
 * Register a *named* connection alongside any others — the way to use more than
 * one database. Point a query or model at it by name; nothing else changes.
 *
 *   addConnection("reporting", pgConn, "postgres");
 *   await db("events", "reporting").where("kind", "signup").count();
 */
export function addConnection(name: string, conn: Connection, driverDialect: Dialect = "sqlite"): void {
  registry.set(name, { name, conn, dialect: driverDialect });
}

/** Choose which registered connection `db()` and models use when none is named. */
export function setDefaultConnection(name: string): void {
  if (!registry.has(name)) throw new Error(`No database connection "${name}" to make default.`);
  defaultConnection = name;
}

/** The names of every registered connection. */
export function connectionNames(): string[] {
  return [...registry.keys()];
}

/** Unregister every connection — a test helper for a clean slate. */
export function clearConnections(): void {
  registry.clear();
  defaultConnection = "default";
}

/** Resolve a connection by name (or the default); throws if it isn't registered. */
function resolve(name?: string): Source {
  const source = registry.get(name ?? defaultConnection);
  if (!source) {
    throw new Error(
      `No database connection${name ? ` "${name}"` : ""}. ` +
        `Call setConnection(conn, dialect) or addConnection(name, conn, dialect).`,
    );
  }
  return source;
}

/** Render `?` placeholders for a dialect (Postgres uses $1, $2, …). */
function placeholders(sql: string, dialect: Dialect): string {
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

  // The connection is resolved lazily, when a query actually runs — so building
  // a query never throws, and an unregistered connection surfaces as a rejected
  // read/write rather than a synchronous error at construction.
  constructor(private table: string, private getSource: () => Source) {}

  /** Run a row-returning query on this builder's connection, dialect-adjusted. */
  private runSelect(sql: string, bindings: unknown[]): Promise<Row[]> {
    return selectOn(this.getSource(), sql, bindings);
  }
  /** Run a write on this builder's connection, dialect-adjusted. */
  private runWrite(sql: string, bindings: unknown[]): Promise<WriteResult> {
    return writeOn(this.getSource(), sql, bindings);
  }

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
    return (await this.runSelect(sql, where.bindings)) as T[];
  }

  async first(): Promise<T | null> {
    this._limit = 1;
    const rows = await this.get();
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    const where = this.whereClause();
    const rows = (await this.runSelect(
      `SELECT COUNT(*) AS count FROM ${this.table}${where.sql}`,
      where.bindings,
    )) as { count: number }[];
    return Number(rows[0]?.count ?? 0);
  }

  async exists(): Promise<boolean> {
    return (await this.count()) > 0;
  }

  private async aggregate(fn: string, column: string): Promise<number> {
    const where = this.whereClause();
    const rows = (await this.runSelect(
      `SELECT ${fn}(${column}) AS agg FROM ${this.table}${where.sql}`,
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
    return this.runWrite(sql, Object.values(data));
  }

  async insertGetId(data: Row): Promise<number | string | undefined> {
    return (await this.insert(data)).insertId;
  }

  async update(data: Row): Promise<WriteResult> {
    const keys = Object.keys(data);
    const set = keys.map((k) => `${k} = ?`).join(", ");
    const where = this.whereClause();
    return this.runWrite(`UPDATE ${this.table} SET ${set}${where.sql}`, [
      ...Object.values(data),
      ...where.bindings,
    ]);
  }

  async delete(): Promise<WriteResult> {
    const where = this.whereClause();
    return this.runWrite(`DELETE FROM ${this.table}${where.sql}`, where.bindings);
  }
}

/** Start a query against a table, on the default connection or a named one. */
export function db<T extends Row = Row>(table: string, connectionName?: string): QueryBuilder<T> {
  return new QueryBuilder<T>(table, () => resolve(connectionName));
}

/** A handle to one registered connection — query it, or run raw SQL on it. */
export interface ConnectionHandle {
  /** Start a query against a table on this connection. */
  table<T extends Row = Row>(table: string): QueryBuilder<T>;
  /** Run a raw row-returning query (`?` placeholders, dialect-adjusted). */
  select(sql: string, bindings?: unknown[]): Promise<Row[]>;
  /** Run a raw write (`?` placeholders, dialect-adjusted). */
  write(sql: string, bindings?: unknown[]): Promise<WriteResult>;
  /** This connection's SQL dialect. */
  readonly dialect: Dialect;
}

/**
 * Get a handle to a named connection (or the default). Use it to run several
 * queries against one database without repeating the name, or to reach the raw
 * `select`/`write` bridge.
 *
 *   const reporting = connection("reporting");
 *   await reporting.table("events").where("kind", "signup").count();
 */
export function connection(name?: string): ConnectionHandle {
  const source = resolve(name);
  return {
    table: <T extends Row = Row>(t: string) => new QueryBuilder<T>(t, () => source),
    select: (sql, bindings = []) => selectOn(source, sql, bindings),
    write: (sql, bindings = []) => writeOn(source, sql, bindings),
    dialect: source.dialect,
  };
}

/**
 * The raw driver bridge and dialect for a connection (or the default) — what the
 * `Migrator` needs. Unlike `connection()`, this hands back the unadjusted
 * `Connection` so the migrator can apply its own placeholder conversion.
 */
export function getConnection(name?: string): { connection: Connection; dialect: Dialect; name: string } {
  const source = resolve(name);
  return { connection: source.conn, dialect: source.dialect, name: source.name };
}
