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

import { AsyncLocalStorage } from "node:async_hooks";

import { instrument, currentRequestId } from "./instrumentation.js";
import { NotFoundException } from "./exceptions.js";

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

/** A page without a total, returned by `simplePaginate()`. */
export interface SimplePaginated<T> {
  data: T[];
  perPage: number;
  currentPage: number;
  hasMore: boolean;
}

/** The bridge to your database driver. */
export interface Connection {
  /** Run a SELECT (or any row-returning query) and return the rows. */
  select(sql: string, bindings: unknown[]): Promise<Row[]>;
  /** Run an INSERT/UPDATE/DELETE and return write metadata. */
  write(sql: string, bindings: unknown[]): Promise<WriteResult>;

  /**
   * Start a transaction on a **dedicated** connection.
   *
   * This is optional, but it is not optional for a *pooled* driver, and getting
   * that wrong is the classic way to ship a transaction that silently isn't one:
   * a pool hands each statement to whichever connection is free, so a `BEGIN`
   * and the `INSERT` after it can land on different connections. The `BEGIN`
   * then wraps nothing, the `COMMIT` commits nothing, and a failure half-writes.
   *
   * A driver that pools MUST implement this by checking out one connection and
   * running the whole transaction on it. A driver that owns a single connection
   * (SQLite, libSQL, a bare `pg.Client`) can leave it out, and Keel falls back to
   * issuing `BEGIN` / `COMMIT` / `ROLLBACK` on the connection it has.
   */
  begin?(): Promise<TransactionConnection>;
}

/** A connection with an open transaction on it. */
export interface TransactionConnection extends Connection {
  commit(): Promise<void>;
  rollback(): Promise<void>;
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

/* ----------------------------- transactions --------------------------- */

/** The transaction in flight on a connection, if any. */
interface TxState {
  source: Source;
  /** 0 for the outermost transaction; deeper values are savepoints. */
  depth: number;
}

/**
 * The transactions open on the *current async context*, keyed by connection name.
 *
 * This is what makes an ambient transaction work: `db("users")` inside
 * `transaction(...)` resolves to the transaction's connection without anyone
 * passing it down. `AsyncLocalStorage` (not a module global) is what keeps two
 * concurrent requests from stealing each other's transaction.
 */
const openTransactions = new AsyncLocalStorage<Map<string, TxState>>();

/** The registered connection under a name — ignoring any open transaction. */
function lookup(name?: string): Source {
  const source = registry.get(name ?? defaultConnection);
  if (!source) {
    throw new Error(
      `No database connection${name ? ` "${name}"` : ""}. ` +
        `Call setConnection(conn, dialect) or addConnection(name, conn, dialect).`,
    );
  }
  return source;
}

/**
 * Resolve a connection by name (or the default); throws if it isn't registered.
 * A transaction open on that connection wins — that's the ambient part.
 */
function resolve(name?: string): Source {
  const key = name ?? defaultConnection;
  const open = openTransactions.getStore()?.get(key);
  return open ? open.source : lookup(key);
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
  private joins: string[] = [];
  private groups: string[] = [];
  private havings: Where[] = [];
  private _distinct = false;
  private _randomOrder = false;
  private _lock?: "update" | "share";

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

  /** Append columns to the SELECT list without replacing it. */
  addSelect(...columns: string[]): this {
    if (!columns.length) return this;
    this.columns = this.columns === "*" ? columns.join(", ") : `${this.columns}, ${columns.join(", ")}`;
    return this;
  }

  /** A raw SELECT expression, e.g. `selectRaw("COUNT(*) AS n")`. */
  selectRaw(sql: string): this {
    return this.addSelect(sql);
  }

  /** Wrap a callback's conditions in parentheses, joined to the rest with `boolean`. */
  private whereGroup(fn: (query: QueryBuilder) => void, boolean: "AND" | "OR"): this {
    const sub = new QueryBuilder<T>(this.table, this.getSource);
    fn(sub);
    if (sub.wheres.length) {
      const inner = sub.wheres.map((w, i) => (i === 0 ? "" : `${w.boolean} `) + w.sql).join(" ");
      this.wheres.push({ boolean, sql: `(${inner})`, bindings: sub.wheres.flatMap((w) => w.bindings) });
    }
    return this;
  }

  where(group: (query: QueryBuilder) => void): this;
  where(column: string, value: unknown): this;
  where(column: string, operator: Operator, value: unknown): this;
  where(column: string | ((query: QueryBuilder) => void), opOrValue?: unknown, value?: unknown): this {
    if (typeof column === "function") return this.whereGroup(column, "AND");
    const [op, val] = value === undefined ? ["=", opOrValue] : [opOrValue, value];
    this.wheres.push({ boolean: "AND", sql: `${column} ${op} ?`, bindings: [val] });
    return this;
  }

  orWhere(group: (query: QueryBuilder) => void): this;
  orWhere(column: string, value: unknown): this;
  orWhere(column: string, operator: Operator, value: unknown): this;
  orWhere(column: string | ((query: QueryBuilder) => void), opOrValue?: unknown, value?: unknown): this {
    if (typeof column === "function") return this.whereGroup(column, "OR");
    const [op, val] = value === undefined ? ["=", opOrValue] : [opOrValue, value];
    this.wheres.push({ boolean: "OR", sql: `${column} ${op} ?`, bindings: [val] });
    return this;
  }

  /** Negate a simple comparison: `whereNot("status", "active")`. */
  whereNot(column: string, opOrValue: unknown, value?: unknown): this {
    const [op, val] = value === undefined ? ["=", opOrValue] : [opOrValue, value];
    this.wheres.push({ boolean: "AND", sql: `NOT (${column} ${op} ?)`, bindings: [val] });
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

  /** Compare two columns (no binding): `whereColumn("updated_at", ">", "created_at")`. */
  whereColumn(first: string, opOrSecond: string, second?: string): this {
    const [op, col] = second === undefined ? ["=", opOrSecond] : [opOrSecond, second];
    this.wheres.push({ boolean: "AND", sql: `${first} ${op} ${col}`, bindings: [] });
    return this;
  }

  whereNotBetween(column: string, [min, max]: [unknown, unknown]): this {
    this.wheres.push({ boolean: "AND", sql: `${column} NOT BETWEEN ? AND ?`, bindings: [min, max] });
    return this;
  }

  /** A raw WHERE fragment with its own bindings. */
  whereRaw(sql: string, bindings: unknown[] = []): this {
    this.wheres.push({ boolean: "AND", sql, bindings });
    return this;
  }

  /* --------------------------- OR variants --------------------------- */

  orWhereIn(column: string, values: unknown[]): this {
    const marks = values.map(() => "?").join(", ");
    this.wheres.push({ boolean: "OR", sql: `${column} IN (${marks})`, bindings: values });
    return this;
  }
  orWhereNotIn(column: string, values: unknown[]): this {
    const marks = values.map(() => "?").join(", ");
    this.wheres.push({ boolean: "OR", sql: `${column} NOT IN (${marks})`, bindings: values });
    return this;
  }
  orWhereNull(column: string): this {
    this.wheres.push({ boolean: "OR", sql: `${column} IS NULL`, bindings: [] });
    return this;
  }
  orWhereNotNull(column: string): this {
    this.wheres.push({ boolean: "OR", sql: `${column} IS NOT NULL`, bindings: [] });
    return this;
  }
  orWhereBetween(column: string, [min, max]: [unknown, unknown]): this {
    this.wheres.push({ boolean: "OR", sql: `${column} BETWEEN ? AND ?`, bindings: [min, max] });
    return this;
  }
  orWhereColumn(first: string, opOrSecond: string, second?: string): this {
    const [op, col] = second === undefined ? ["=", opOrSecond] : [opOrSecond, second];
    this.wheres.push({ boolean: "OR", sql: `${first} ${op} ${col}`, bindings: [] });
    return this;
  }
  orWhereLike(column: string, pattern: string): this {
    this.wheres.push({ boolean: "OR", sql: `${column} LIKE ?`, bindings: [pattern] });
    return this;
  }
  orWhereRaw(sql: string, bindings: unknown[] = []): this {
    this.wheres.push({ boolean: "OR", sql, bindings });
    return this;
  }

  join(table: string, first: string, opOrSecond: string, second?: string): this {
    const [op, col] = second === undefined ? ["=", opOrSecond] : [opOrSecond, second];
    this.joins.push(`INNER JOIN ${table} ON ${first} ${op} ${col}`);
    return this;
  }
  leftJoin(table: string, first: string, opOrSecond: string, second?: string): this {
    const [op, col] = second === undefined ? ["=", opOrSecond] : [opOrSecond, second];
    this.joins.push(`LEFT JOIN ${table} ON ${first} ${op} ${col}`);
    return this;
  }
  rightJoin(table: string, first: string, opOrSecond: string, second?: string): this {
    const [op, col] = second === undefined ? ["=", opOrSecond] : [opOrSecond, second];
    this.joins.push(`RIGHT JOIN ${table} ON ${first} ${op} ${col}`);
    return this;
  }
  crossJoin(table: string): this {
    this.joins.push(`CROSS JOIN ${table}`);
    return this;
  }

  groupBy(...columns: string[]): this {
    this.groups.push(...columns);
    return this;
  }
  groupByRaw(sql: string): this {
    this.groups.push(sql);
    return this;
  }

  having(column: string, opOrValue: unknown, value?: unknown): this {
    const [op, val] = value === undefined ? ["=", opOrValue] : [opOrValue, value];
    this.havings.push({ boolean: "AND", sql: `${column} ${op} ?`, bindings: [val] });
    return this;
  }
  havingRaw(sql: string, bindings: unknown[] = []): this {
    this.havings.push({ boolean: "AND", sql, bindings });
    return this;
  }
  havingBetween(column: string, [min, max]: [unknown, unknown]): this {
    this.havings.push({ boolean: "AND", sql: `${column} BETWEEN ? AND ?`, bindings: [min, max] });
    return this;
  }

  distinct(): this {
    this._distinct = true;
    return this;
  }

  /** Apply `then` only when `condition` is truthy (optionally `otherwise`). */
  when(
    condition: unknown,
    then: (query: this, value: unknown) => void,
    otherwise?: (query: this, value: unknown) => void,
  ): this {
    if (condition) then(this, condition);
    else otherwise?.(this, condition);
    return this;
  }

  /** The inverse of `when` — apply `then` only when `condition` is falsy. */
  unless(
    condition: unknown,
    then: (query: this, value: unknown) => void,
    otherwise?: (query: this, value: unknown) => void,
  ): this {
    if (!condition) then(this, condition);
    else otherwise?.(this, condition);
    return this;
  }

  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    this.orders.push(`${column} ${direction.toUpperCase()}`);
    return this;
  }
  orderByDesc(column: string): this {
    return this.orderBy(column, "desc");
  }

  /** A raw ORDER BY fragment, e.g. `orderByRaw("LENGTH(name) DESC")`. */
  orderByRaw(sql: string): this {
    this.orders.push(sql);
    return this;
  }

  /** Drop existing ordering, optionally setting a new one. */
  reorder(column?: string, direction: "asc" | "desc" = "asc"): this {
    this.orders = [];
    this._randomOrder = false;
    if (column) this.orderBy(column, direction);
    return this;
  }

  /** Order rows randomly (dialect-aware `RANDOM()` / `RAND()`). */
  inRandomOrder(): this {
    this._randomOrder = true;
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
  /** Alias of `limit`. */
  take(n: number): this {
    return this.limit(n);
  }
  /** Alias of `offset`. */
  skip(n: number): this {
    return this.offset(n);
  }
  /** Limit/offset for a given page (1-based). */
  forPage(page: number, perPage = 15): this {
    return this.offset((Math.max(1, page) - 1) * perPage).limit(perPage);
  }

  /** Add `FOR UPDATE` (write lock) to the SELECT; ignored on sqlite. */
  lockForUpdate(): this {
    this._lock = "update";
    return this;
  }
  /** Add `FOR SHARE` (read lock) to the SELECT; ignored on sqlite. */
  sharedLock(): this {
    this._lock = "share";
    return this;
  }

  private whereClause(): { sql: string; bindings: unknown[] } {
    if (!this.wheres.length) return { sql: "", bindings: [] };
    const sql =
      " WHERE " +
      this.wheres.map((w, i) => (i === 0 ? "" : `${w.boolean} `) + w.sql).join(" ");
    return { sql, bindings: this.wheres.flatMap((w) => w.bindings) };
  }

  private havingClause(): { sql: string; bindings: unknown[] } {
    if (!this.havings.length) return { sql: "", bindings: [] };
    const sql =
      " HAVING " +
      this.havings.map((w, i) => (i === 0 ? "" : `${w.boolean} `) + w.sql).join(" ");
    return { sql, bindings: this.havings.flatMap((w) => w.bindings) };
  }

  private joinSql(): string {
    return this.joins.length ? ` ${this.joins.join(" ")}` : "";
  }

  /* ------------------------------- reads ------------------------------- */

  /** Compile the SELECT into `?`-placeholder SQL plus its bindings. */
  private compileSelect(dialect?: Dialect): { sql: string; bindings: unknown[] } {
    const where = this.whereClause();
    const having = this.havingClause();
    let sql = `SELECT ${this._distinct ? "DISTINCT " : ""}${this.columns} FROM ${this.table}`;
    sql += this.joinSql() + where.sql;
    if (this.groups.length) sql += ` GROUP BY ${this.groups.join(", ")}`;
    sql += having.sql;
    const orders = [...this.orders];
    if (this._randomOrder) orders.push(dialect === "mysql" ? "RAND()" : "RANDOM()");
    if (orders.length) sql += ` ORDER BY ${orders.join(", ")}`;
    if (this._limit != null) sql += ` LIMIT ${this._limit}`;
    if (this._offset != null) sql += ` OFFSET ${this._offset}`;
    if (this._lock && dialect && dialect !== "sqlite") {
      sql += this._lock === "update" ? " FOR UPDATE" : " FOR SHARE";
    }
    return { sql, bindings: [...where.bindings, ...having.bindings] };
  }

  async get(): Promise<T[]> {
    const source = this.getSource();
    const { sql, bindings } = this.compileSelect(source.dialect);
    return (await selectOn(source, sql, bindings)) as T[];
  }

  async first(): Promise<T | null> {
    this._limit = 1;
    const rows = await this.get();
    return rows[0] ?? null;
  }

  /** The first row, or throw `NotFoundException` when there is none. */
  async firstOrFail(): Promise<T> {
    const row = await this.first();
    if (!row) throw new NotFoundException(`No row found in ${this.table}`);
    return row;
  }

  /** Find by primary key (default `id`), or null. */
  async find(id: unknown, key = "id"): Promise<T | null> {
    return this.where(key, id).first();
  }

  /** Exactly one row: throws if none, or if more than one matches. */
  async sole(): Promise<T> {
    this._limit = 2;
    const rows = await this.get();
    if (rows.length === 0) throw new NotFoundException(`No row found in ${this.table}`);
    if (rows.length > 1) throw new Error(`Multiple rows found in ${this.table}`);
    return rows[0]!;
  }

  /** The SQL this query would run, with `?` placeholders (does not execute). */
  toSql(): string {
    return this.compileSelect().sql;
  }
  /** The bindings this query would run with. */
  getBindings(): unknown[] {
    return this.compileSelect().bindings;
  }
  /** Log the compiled SQL + bindings, then return the builder for chaining. */
  dump(): this {
    console.log(this.toSql(), this.getBindings());
    return this;
  }
  /** Dump the compiled SQL + bindings and throw, halting execution. */
  dd(): never {
    console.log(this.toSql(), this.getBindings());
    throw new Error("dd(): query dumped");
  }

  async count(): Promise<number> {
    const where = this.whereClause();
    const rows = (await this.runSelect(
      `SELECT COUNT(*) AS count FROM ${this.table}${this.joinSql()}${where.sql}`,
      where.bindings,
    )) as { count: number }[];
    return Number(rows[0]?.count ?? 0);
  }

  async exists(): Promise<boolean> {
    return (await this.count()) > 0;
  }

  async doesntExist(): Promise<boolean> {
    return !(await this.exists());
  }

  private async aggregate(fn: string, column: string): Promise<number> {
    const where = this.whereClause();
    const rows = (await this.runSelect(
      `SELECT ${fn}(${column}) AS agg FROM ${this.table}${this.joinSql()}${where.sql}`,
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

  /** Join a single column's values into a string. */
  async implode(column: string, glue = ""): Promise<string> {
    return (await this.pluck(column)).join(glue);
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

  /**
   * A lighter page: no `COUNT` query. Fetches one extra row to know whether a
   * next page exists — cheaper for "load more" UIs that don't need a total.
   */
  async simplePaginate(page = 1, perPage = 15): Promise<SimplePaginated<T>> {
    this._limit = perPage + 1;
    this._offset = (Math.max(1, page) - 1) * perPage;
    const rows = await this.get();
    const hasMore = rows.length > perPage;
    return { data: hasMore ? rows.slice(0, perPage) : rows, perPage, currentPage: page, hasMore };
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

  /** Empty the table. */
  async truncate(): Promise<WriteResult> {
    const dialect = this.getSource().dialect;
    // sqlite has no TRUNCATE; a bare DELETE is the portable equivalent.
    if (dialect === "sqlite") return this.runWrite(`DELETE FROM ${this.table}`, []);
    return this.runWrite(`TRUNCATE TABLE ${this.table}`, []);
  }

  /** Update the first matching row, or insert `{ ...match, ...values }` if none. */
  async updateOrInsert(match: Row, values: Row = {}): Promise<WriteResult> {
    for (const [column, value] of Object.entries(match)) this.where(column, value);
    if (await this.exists()) return this.update(values);
    return this.insert({ ...match, ...values });
  }

  /** Atomically add to a numeric column (optionally setting other columns too). */
  increment(column: string, amount = 1, extra: Row = {}): Promise<WriteResult> {
    const where = this.whereClause();
    const sets = [`${column} = ${column} + ?`, ...Object.keys(extra).map((k) => `${k} = ?`)];
    const bindings = [amount, ...Object.values(extra), ...where.bindings];
    return this.runWrite(`UPDATE ${this.table} SET ${sets.join(", ")}${where.sql}`, bindings);
  }

  /** Atomically subtract from a numeric column. */
  decrement(column: string, amount = 1, extra: Row = {}): Promise<WriteResult> {
    const where = this.whereClause();
    const sets = [`${column} = ${column} - ?`, ...Object.keys(extra).map((k) => `${k} = ?`)];
    const bindings = [amount, ...Object.values(extra), ...where.bindings];
    return this.runWrite(`UPDATE ${this.table} SET ${sets.join(", ")}${where.sql}`, bindings);
  }

  /** Increment several columns by 1 (or per-column amounts) in one statement. */
  incrementEach(columns: string[] | Record<string, number>, extra: Row = {}): Promise<WriteResult> {
    return this.stepEach("+", columns, extra);
  }
  /** Decrement several columns by 1 (or per-column amounts) in one statement. */
  decrementEach(columns: string[] | Record<string, number>, extra: Row = {}): Promise<WriteResult> {
    return this.stepEach("-", columns, extra);
  }
  private stepEach(op: "+" | "-", columns: string[] | Record<string, number>, extra: Row): Promise<WriteResult> {
    const entries = Array.isArray(columns) ? columns.map((c) => [c, 1] as const) : Object.entries(columns);
    const where = this.whereClause();
    const sets = [
      ...entries.map(([c]) => `${c} = ${c} ${op} ?`),
      ...Object.keys(extra).map((k) => `${k} = ?`),
    ];
    const bindings = [...entries.map(([, n]) => n), ...Object.values(extra), ...where.bindings];
    return this.runWrite(`UPDATE ${this.table} SET ${sets.join(", ")}${where.sql}`, bindings);
  }

  /** Insert one or more rows, ignoring any that violate a unique constraint. */
  async insertOrIgnore(rows: Row | Row[]): Promise<WriteResult> {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return { rowsAffected: 0 };
    const dialect = this.getSource().dialect;
    const keys = Object.keys(list[0]!);
    const values = list.map(() => `(${keys.map(() => "?").join(", ")})`).join(", ");
    const bindings = list.flatMap((r) => keys.map((k) => r[k]));
    const verb = dialect === "mysql" ? "INSERT IGNORE" : "INSERT";
    const suffix = dialect === "postgres" || dialect === "sqlite" ? " ON CONFLICT DO NOTHING" : "";
    return this.runWrite(
      `${verb} INTO ${this.table} (${keys.join(", ")}) VALUES ${values}${suffix}`,
      bindings,
    );
  }

  /**
   * Insert rows, updating `update` columns on a conflict against `uniqueBy`.
   * Dialect-aware: `ON CONFLICT … DO UPDATE` (sqlite/postgres) or
   * `ON DUPLICATE KEY UPDATE` (mysql).
   */
  async upsert(rows: Row | Row[], uniqueBy: string[], update?: string[]): Promise<WriteResult> {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return { rowsAffected: 0 };
    const dialect = this.getSource().dialect;
    const keys = Object.keys(list[0]!);
    const cols = update ?? keys.filter((k) => !uniqueBy.includes(k));
    const values = list.map(() => `(${keys.map(() => "?").join(", ")})`).join(", ");
    const bindings = list.flatMap((r) => keys.map((k) => r[k]));

    let sql = `INSERT INTO ${this.table} (${keys.join(", ")}) VALUES ${values}`;
    if (dialect === "mysql") {
      sql += ` ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(", ")}`;
    } else {
      sql += ` ON CONFLICT (${uniqueBy.join(", ")}) DO UPDATE SET ${cols
        .map((c) => `${c} = excluded.${c}`)
        .join(", ")}`;
    }
    return this.runWrite(sql, bindings);
  }

  /**
   * Process results in pages of `size`, so a large table never loads at once.
   * The callback runs per page; return `false` from it to stop early.
   */
  async chunk(size: number, callback: (rows: T[]) => void | boolean | Promise<void | boolean>): Promise<void> {
    let offset = 0;
    for (;;) {
      this._limit = size;
      this._offset = offset;
      const rows = await this.get();
      if (!rows.length) return;
      if ((await callback(rows)) === false) return;
      if (rows.length < size) return;
      offset += size;
    }
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
/** A handle to the transaction in flight, handed to `transaction()`'s callback. */
export interface TransactionHandle extends ConnectionHandle {
  /**
   * Roll back now and abandon the rest of the transaction. The callback should
   * return straight after — queries on a rolled-back transaction will fail.
   */
  rollback(): Promise<void>;
  /** 0 for the outermost transaction; deeper values are savepoints. */
  readonly depth: number;
}

function handleFor(source: Source, depth: number, rollback: () => Promise<void>): TransactionHandle {
  return {
    table: <T extends Row = Row>(t: string) => new QueryBuilder<T>(t, () => source),
    select: (sql, bindings = []) => selectOn(source, sql, bindings),
    write: (sql, bindings = []) => writeOn(source, sql, bindings),
    dialect: source.dialect,
    depth,
    rollback,
  };
}

/** Open a transaction: the driver's own if it has one, else BEGIN on what we have. */
async function begin(source: Source): Promise<{
  source: Source;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}> {
  if (source.conn.begin) {
    const tx = await source.conn.begin();
    return {
      source: { name: source.name, conn: tx, dialect: source.dialect },
      commit: () => tx.commit(),
      rollback: () => tx.rollback(),
    };
  }

  await writeOn(source, "BEGIN", []);
  return {
    source,
    commit: async () => void (await writeOn(source, "COMMIT", [])),
    rollback: async () => void (await writeOn(source, "ROLLBACK", [])),
  };
}

/**
 * Run `fn` inside a database transaction. It commits when `fn` returns, and
 * **rolls back if `fn` throws** — which is the entire point: two related writes
 * either both land or neither does, so a failure between them can't leave the row
 * charged and the order missing.
 *
 *   await transaction(async () => {
 *     await db("orders").insert(order);
 *     await db("stock").where("id", id).decrement("count");   // a throw here undoes the insert
 *   });
 *
 * Queries inside are **ambient**: `db()`, models, and relations all pick up the
 * transaction's connection without being handed it. The callback also gets an
 * explicit handle if you'd rather be obvious about it:
 *
 *   await transaction(async (tx) => {
 *     await tx.table("orders").insert(order);
 *   });
 *
 * **Nesting uses savepoints.** A `transaction()` inside another doesn't open a
 * second transaction — databases don't have those — it takes a savepoint, so an
 * inner failure rolls back only the inner work and the outer transaction carries
 * on. Without that, a nested helper's failure would silently abandon its caller's
 * writes too.
 */
export async function transaction<T>(
  fn: (tx: TransactionHandle) => Promise<T> | T,
  connectionName?: string,
): Promise<T> {
  const key = connectionName ?? defaultConnection;
  const store = openTransactions.getStore();
  const open = store?.get(key);

  /* ----------------------------- nested: savepoint ---------------------- */
  if (open) {
    const depth = open.depth + 1;
    const name = `keel_sp_${depth}`;
    const source = open.source;

    await writeOn(source, `SAVEPOINT ${name}`, []);

    const nested = new Map(store);
    nested.set(key, { source, depth });

    let undone = false;
    const undo = async (): Promise<void> => {
      undone = true;
      await writeOn(source, `ROLLBACK TO SAVEPOINT ${name}`, []);
    };

    try {
      const result = await openTransactions.run(nested, () => fn(handleFor(source, depth, undo)));
      if (!undone) await writeOn(source, `RELEASE SAVEPOINT ${name}`, []);
      return result;
    } catch (error) {
      // Only this savepoint is undone — the transaction around it survives.
      if (!undone) await writeOn(source, `ROLLBACK TO SAVEPOINT ${name}`, []);
      throw error;
    }
  }

  /* ---------------------------- outermost ------------------------------- */
  const tx = await begin(lookup(key));

  const next = new Map(store ?? []);
  next.set(key, { source: tx.source, depth: 0 });

  let undone = false;
  const undo = async (): Promise<void> => {
    undone = true;
    await tx.rollback();
  };

  try {
    const result = await openTransactions.run(next, () => fn(handleFor(tx.source, 0, undo)));
    if (!undone) await tx.commit();
    return result;
  } catch (error) {
    if (!undone) {
      // A rollback that itself fails must not replace the error that caused it —
      // that's how you end up debugging the wrong problem.
      await tx.rollback().catch(() => {});
    }
    throw error;
  }
}

/** Whether a transaction is open on this connection in the current context. */
export function inTransaction(connectionName?: string): boolean {
  return openTransactions.getStore()?.has(connectionName ?? defaultConnection) ?? false;
}

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
