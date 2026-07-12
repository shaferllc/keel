/**
 * A tiny active-record Model over the query builder. Subclass it, point it at a
 * table, and get `find` / `all` / `create` / `save` / `delete` — no ORM to
 * configure. Backed by whatever `Connection` you registered with
 * `setConnection()`, so it runs on Node and the edge.
 *
 *   class User extends Model {
 *     static table = "users";
 *     declare id: number;
 *     declare email: string;
 *   }
 *
 *   const user = await User.find(1);
 *   const created = await User.create({ email });
 *   user.email = "new@x.com";
 *   await user.save();
 */

import { db, type QueryBuilder, type Row, type Paginated } from "./database.js";
import { NotFoundException } from "./exceptions.js";
import { BelongsTo, BelongsToMany, HasMany, HasOne } from "./relations.js";
import { applyCasts, castGet, castSet, type Casts } from "./casts.js";
import {
  addModelHook,
  addModelObserver,
  fireModelEvent,
  type ModelHook,
  type ModelObserver,
} from "./model-events.js";
import { ModelQuery } from "./model-query.js";

/** A global scope: a constraint applied to every query a model builds. */
export type GlobalScope = (query: QueryBuilder) => void;

/** Registered global scopes, keyed by the model class they were declared on. */
const globalScopes = new WeakMap<object, Map<string, GlobalScope>>();

/**
 * Every scope that applies to `cls`, including ones declared on its ancestors.
 *
 * Inheritance is the whole point: a base class exists so its subclasses are
 * constrained by it.
 *
 *   class TenantModel extends Model {}
 *   TenantModel.addGlobalScope("tenant", (q) => q.where("teamId", currentTeam()));
 *   class Post extends TenantModel {}     // Post must be scoped too
 *
 * Looking only at the concrete class would leave `Post.query()` completely
 * unconstrained — and a scope that silently does nothing fails *open*, which for
 * a tenancy scope means returning every customer's rows.
 *
 * Walked root-first so a subclass can override an ancestor's scope by reusing its
 * name — the nearest declaration of a given name wins.
 */
function scopesFor(cls: object): Map<string, GlobalScope> {
  const chain: object[] = [];
  for (let c: object | null = cls; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    chain.unshift(c);
  }

  const merged = new Map<string, GlobalScope>();
  for (const link of chain) {
    for (const [name, scope] of globalScopes.get(link) ?? []) merged.set(name, scope);
  }
  return merged;
}

/** How a model query treats soft-deleted rows. */
type TrashedMode = "exclude" | "with" | "only";

type ModelClass<T extends Model> = (new (attributes?: Row) => T) & typeof Model;

/**
 * Loaded relations live off the model itself so they never leak into `save()`
 * (which spreads own columns) — they're keyed here by the owning instance.
 */
const relationStore = new WeakMap<Model, Record<string, unknown>>();

function serialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serialize);
  if (value instanceof Model) return value.toJSON();
  return value;
}

export class Model {
  static table = "";
  static primaryKey = "id";
  /** Which registered connection this model uses; the default when unset. */
  static connection: string | undefined = undefined;

  /** Columns mass-assignable via `create`/`fill` (allowlist). */
  static fillable: string[] = [];
  /** Columns NOT mass-assignable (denylist). Ignored when `fillable` is set. */
  static guarded: string[] = [];
  /** Column -> cast type; values round-trip as real JS types. */
  static casts: Casts = {};

  /** Auto-manage `created_at` / `updated_at` on write. Off by default. */
  static timestamps = false;
  static createdAtColumn = "created_at";
  static updatedAtColumn = "updated_at";

  /** Columns stripped from `toJSON()` output (e.g. `["password"]`). */
  static hidden: string[] = [];
  /** If set, ONLY these keys survive `toJSON()` — an allowlist that wins over `hidden`. */
  static visible: string[] = [];
  /** Computed accessor names (getters or zero-arg methods) added to `toJSON()`. */
  static appends: string[] = [];

  /** Soft deletes: `delete()` sets `deleted_at` instead of removing the row. */
  static softDeletes = false;
  static deletedAtColumn = "deleted_at";

  [key: string]: unknown;

  constructor(attributes: Row = {}) {
    // Hydration is unguarded (rows come from the database) but always cast.
    Object.assign(this, applyCasts(attributes, (this.constructor as typeof Model).casts, castGet));
  }

  /* ------------------------------ static -------------------------------- */

  /* ---------------------------- scopes & events ------------------------- */

  /** Register a global scope — a constraint applied to every query this model builds. */
  static addGlobalScope(name: string, scope: GlobalScope): void {
    let map = globalScopes.get(this);
    if (!map) globalScopes.set(this, (map = new Map()));
    map.set(name, scope);
  }

  /** Build this model's base query, applying global scopes and the soft-delete filter. */
  protected static baseQuery(trashed: TrashedMode = "exclude", skip?: Set<string>): QueryBuilder {
    const query = db(this.table, this.connection);

    for (const [name, scope] of scopesFor(this)) {
      if (skip?.has(name)) continue;
      scope(query);
    }

    if (this.softDeletes) {
      if (trashed === "exclude") query.whereNull(this.deletedAtColumn);
      else if (trashed === "only") query.whereNotNull(this.deletedAtColumn);
    }
    return query;
  }

  /** A query builder scoped to this model's table (global scopes applied). */
  static query(): QueryBuilder {
    return this.baseQuery();
  }

  /**
   * Drop named global scopes from this query.
   *
   * Deliberately explicit and greppable: a query that escapes a tenancy scope is
   * exactly the thing you want to be able to find at audit time, so it has to be
   * *typed out*, not arrived at by forgetting something.
   */
  static withoutGlobalScope(...names: string[]): QueryBuilder {
    return this.baseQuery("exclude", new Set(names));
  }

  /** Drop every global scope. Same warning, louder. */
  static withoutGlobalScopes(): QueryBuilder {
    return this.baseQuery("exclude", new Set(scopesFor(this).keys()));
  }

  /** Include soft-deleted rows (bypasses the soft-delete scope). */
  static withTrashed(): QueryBuilder {
    return this.baseQuery("with");
  }

  /** Only soft-deleted rows. */
  static onlyTrashed(): QueryBuilder {
    return this.baseQuery("only");
  }

  /* --------------------- model-aware query (eager, has) ----------------- */

  /** A model-aware query — hydrates to models and supports `with`/`withCount`/`whereHas`. */
  static newQuery<T extends Model>(this: ModelClass<T>): ModelQuery<T> {
    return new ModelQuery<T>(this, this.baseQuery());
  }

  /** Start a query eager-loading the given relations (dotted paths nest). */
  static with<T extends Model>(this: ModelClass<T>, ...names: string[]): ModelQuery<T> {
    return this.newQuery().with(...names);
  }

  /** Start a query counting the given relations into `<relation>_count`. */
  static withCount<T extends Model>(this: ModelClass<T>, ...names: string[]): ModelQuery<T> {
    return this.newQuery().withCount(...names);
  }

  /** Start a query constrained to models that have at least one related row. */
  static has<T extends Model>(this: ModelClass<T>, name: string): ModelQuery<T> {
    return this.newQuery().has(name);
  }

  /** Start a query constrained to models whose related rows match `constrain`. */
  static whereHas<T extends Model>(
    this: ModelClass<T>,
    name: string,
    constrain?: (q: QueryBuilder) => void,
  ): ModelQuery<T> {
    return this.newQuery().whereHas(name, constrain);
  }

  /** Start a query constrained to models with no matching related row. */
  static doesntHave<T extends Model>(
    this: ModelClass<T>,
    name: string,
    constrain?: (q: QueryBuilder) => void,
  ): ModelQuery<T> {
    return this.newQuery().doesntHave(name, constrain);
  }

  /** Construct a model from a row and fire its `retrieved` event. */
  protected static async hydrate<T extends Model>(this: ModelClass<T>, row: Row): Promise<T> {
    const model = new this(row);
    await fireModelEvent(this, "retrieved", model);
    return model;
  }

  static creating<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "creating", hook as ModelHook);
  }
  static created<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "created", hook as ModelHook);
  }
  static updating<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "updating", hook as ModelHook);
  }
  static updated<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "updated", hook as ModelHook);
  }
  static saving<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "saving", hook as ModelHook);
  }
  static saved<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "saved", hook as ModelHook);
  }
  static deleting<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "deleting", hook as ModelHook);
  }
  static deleted<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "deleted", hook as ModelHook);
  }
  static restoring<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "restoring", hook as ModelHook);
  }
  static restored<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "restored", hook as ModelHook);
  }
  static retrieved<T extends Model>(this: { new (...args: never[]): T }, hook: ModelHook<T>): void {
    addModelHook(this, "retrieved", hook as ModelHook);
  }

  /** Register an observer whose methods are named after the events they handle. */
  static observe<T extends Model>(this: { new (...args: never[]): T }, observer: ModelObserver<T>): void {
    addModelObserver(this, observer as ModelObserver);
  }

  /** Keep only the attributes mass-assignment allows (fillable / guarded). */
  static filterFillable(attributes: Row): Row {
    if (this.fillable.length) {
      const out: Row = {};
      for (const key of this.fillable) if (key in attributes) out[key] = attributes[key];
      return out;
    }
    if (this.guarded.length) {
      const out: Row = { ...attributes };
      for (const key of this.guarded) delete out[key];
      return out;
    }
    return { ...attributes };
  }

  /** Cast attributes to their storable primitives for a write. */
  static toDatabase(attributes: Row): Row {
    return applyCasts(attributes, this.casts, castSet);
  }

  /** Stamp created_at/updated_at onto a write payload when timestamps are on. */
  static stampTimestamps(data: Row, forInsert: boolean): Row {
    if (!this.timestamps) return data;
    const now = new Date().toISOString();
    const out = { ...data };
    if (forInsert) out[this.createdAtColumn] = now;
    out[this.updatedAtColumn] = now;
    return out;
  }

  static async all<T extends Model>(this: ModelClass<T>): Promise<T[]> {
    const rows = await this.baseQuery().get();
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  static async find<T extends Model>(this: ModelClass<T>, id: unknown): Promise<T | null> {
    const row = await this.baseQuery().where(this.primaryKey, id).first();
    return row ? this.hydrate(row) : null;
  }

  static async findOrFail<T extends Model>(this: ModelClass<T>, id: unknown): Promise<T> {
    const model = await (this as ModelClass<T>).find(id);
    if (!model) throw new NotFoundException(`${this.name} ${String(id)} not found`);
    return model;
  }

  static async first<T extends Model>(this: ModelClass<T>): Promise<T | null> {
    const row = await this.baseQuery().first();
    return row ? this.hydrate(row) : null;
  }

  /** Fetch models matching a simple equality condition. */
  static async where<T extends Model>(
    this: ModelClass<T>,
    column: string,
    value: unknown,
  ): Promise<T[]> {
    const rows = await this.baseQuery().where(column, value).get();
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  static async create<T extends Model>(this: ModelClass<T>, attributes: Row): Promise<T> {
    // Route through save() so mass-assignment, timestamps, and the saving/creating
    // lifecycle events all apply in one place.
    const model = new this();
    model.fill(attributes);
    await model.save();
    return model;
  }

  /** A page of models plus pagination metadata. */
  static async paginate<T extends Model>(
    this: ModelClass<T>,
    page = 1,
    perPage = 15,
  ): Promise<Paginated<T>> {
    const result = await this.baseQuery().paginate(page, perPage);
    return { ...result, data: await Promise.all(result.data.map((row) => this.hydrate(row))) };
  }

  /** Find the first row matching `match`, or create one from `{ ...match, ...values }`. */
  static async firstOrCreate<T extends Model>(
    this: ModelClass<T>,
    match: Row,
    values: Row = {},
  ): Promise<T> {
    const row = await this.matching(match).first();
    if (row) return this.hydrate(row);
    return (this as ModelClass<T>).create({ ...match, ...values });
  }

  /** Update the first row matching `match` with `values`, or create it. */
  static async updateOrCreate<T extends Model>(
    this: ModelClass<T>,
    match: Row,
    values: Row = {},
  ): Promise<T> {
    const row = await this.matching(match).first();
    if (row) {
      const model = await this.hydrate(row);
      await model.forceFill(values).save();
      return model;
    }
    return (this as ModelClass<T>).create({ ...match, ...values });
  }

  /** A query scoped to every column/value in `match` (global scopes applied). */
  private static matching(match: Row): QueryBuilder {
    const q = this.baseQuery();
    for (const [column, value] of Object.entries(match)) q.where(column, value);
    return q;
  }

  /**
   * Eager-load relations onto an array of models with one extra query each —
   * the fix for N+1. Each name must be a relationship method on the model.
   */
  static async load<T extends Model>(models: T[], ...names: string[]): Promise<T[]> {
    if (!models.length) return models;
    for (const name of names) {
      const method = (models[0] as Record<string, unknown>)[name];
      if (typeof method !== "function") {
        throw new Error(`${models[0]!.constructor.name} has no relation "${name}"`);
      }
      const relation = method.call(models[0]) as {
        eager(models: Model[], name: string): Promise<void>;
      };
      await relation.eager(models, name);
    }
    return models;
  }

  /* ----------------------------- instance ------------------------------- */

  private ctor(): typeof Model {
    return this.constructor as typeof Model;
  }

  /* --------------------------- relationships ---------------------------- */

  /** The default foreign key a child of this model would carry (e.g. `user_id`). */
  private foreignKeyName(): string {
    return `${this.constructor.name.toLowerCase()}_${this.ctor().primaryKey}`;
  }

  /** This model has many `related` rows, joined by a foreign key on `related`. */
  hasMany<T extends Model>(
    related: ModelClass<T>,
    foreignKey: string = this.foreignKeyName(),
    localKey: string = this.ctor().primaryKey,
  ): HasMany<T> {
    return new HasMany<T>(this, related, foreignKey, localKey);
  }

  /** This model has one `related` row, joined by a foreign key on `related`. */
  hasOne<T extends Model>(
    related: ModelClass<T>,
    foreignKey: string = this.foreignKeyName(),
    localKey: string = this.ctor().primaryKey,
  ): HasOne<T> {
    return new HasOne<T>(this, related, foreignKey, localKey);
  }

  /** This model belongs to a `related` row via a foreign key it carries. */
  belongsTo<T extends Model>(
    related: ModelClass<T>,
    foreignKey: string = `${related.name.toLowerCase()}_${related.primaryKey}`,
    ownerKey: string = related.primaryKey,
  ): BelongsTo<T> {
    return new BelongsTo<T>(this, related, foreignKey, ownerKey);
  }

  /** Many-to-many through a pivot table (default name: the two tables, sorted). */
  belongsToMany<T extends Model>(
    related: ModelClass<T>,
    pivotTable: string = [this.constructor.name, related.name]
      .map((n) => n.toLowerCase())
      .sort()
      .join("_"),
    foreignPivotKey: string = `${this.constructor.name.toLowerCase()}_${this.ctor().primaryKey}`,
    relatedPivotKey: string = `${related.name.toLowerCase()}_${related.primaryKey}`,
    parentKey: string = this.ctor().primaryKey,
    relatedKey: string = related.primaryKey,
  ): BelongsToMany<T> {
    return new BelongsToMany<T>(
      this,
      related,
      pivotTable,
      foreignPivotKey,
      relatedPivotKey,
      parentKey,
      relatedKey,
    );
  }

  /** Store an eager-loaded relation result under `name`. */
  setRelation(name: string, value: unknown): this {
    const bag = relationStore.get(this) ?? {};
    bag[name] = value;
    relationStore.set(this, bag);
    return this;
  }

  /** Read a previously loaded relation (returns undefined if not loaded). */
  getRelation<T = unknown>(name: string): T | undefined {
    return relationStore.get(this)?.[name] as T | undefined;
  }

  /** Insert (no primary key) or update (has one). Fires save/create/update events. */
  async save(): Promise<this> {
    const ctor = this.ctor();
    const cls = this.constructor as object;
    const { table, primaryKey, connection } = ctor;
    const idValue = (this as Row)[primaryKey];
    const forInsert = idValue == null;

    // `*ing` hooks run before the write and may mutate the model or veto it.
    if (!(await fireModelEvent(cls, "saving", this))) return this;
    if (!(await fireModelEvent(cls, forInsert ? "creating" : "updating", this))) return this;

    const data: Row = ctor.stampTimestamps(ctor.toDatabase({ ...this }), forInsert);
    // Reflect the stamps back onto the instance.
    if (ctor.timestamps) {
      if (forInsert) (this as Row)[ctor.createdAtColumn] = data[ctor.createdAtColumn];
      (this as Row)[ctor.updatedAtColumn] = data[ctor.updatedAtColumn];
    }
    delete data[primaryKey];

    if (!forInsert) {
      await db(table, connection).where(primaryKey, idValue).update(data);
    } else {
      const id = await db(table, connection).insertGetId(data);
      if (id != null) (this as Row)[primaryKey] = id;
    }

    await fireModelEvent(cls, forInsert ? "created" : "updated", this);
    await fireModelEvent(cls, "saved", this);
    return this;
  }

  /** Mass-assign then save — `fill` + `save` in one call. */
  async update(attributes: Row): Promise<this> {
    return this.fill(attributes).save();
  }

  /** Reload this model's columns from the database. */
  async refresh(): Promise<this> {
    const ctor = this.ctor();
    const row = await db(ctor.table, ctor.connection).where(ctor.primaryKey, this[ctor.primaryKey]).first();
    if (row) Object.assign(this, applyCasts(row, ctor.casts, castGet));
    return this;
  }

  /** Delete the row — or, with soft deletes on, set `deleted_at`. Fires delete events. */
  async delete(): Promise<void> {
    const ctor = this.ctor();
    const cls = this.constructor as object;
    const { table, primaryKey, connection } = ctor;
    if (!(await fireModelEvent(cls, "deleting", this))) return;
    if (ctor.softDeletes) {
      const now = new Date().toISOString();
      await db(table, connection)
        .where(primaryKey, this[primaryKey])
        .update({ [ctor.deletedAtColumn]: now });
      (this as Row)[ctor.deletedAtColumn] = now;
    } else {
      await db(table, connection).where(primaryKey, this[primaryKey]).delete();
    }
    await fireModelEvent(cls, "deleted", this);
  }

  /** Permanently delete a soft-deletable row (bypasses soft deletes). */
  async forceDelete(): Promise<void> {
    const ctor = this.ctor();
    const cls = this.constructor as object;
    if (!(await fireModelEvent(cls, "deleting", this))) return;
    await db(ctor.table, ctor.connection).where(ctor.primaryKey, this[ctor.primaryKey]).delete();
    await fireModelEvent(cls, "deleted", this);
  }

  /** Restore a soft-deleted row (clears `deleted_at`). Fires restore events. */
  async restore(): Promise<this> {
    const ctor = this.ctor();
    const cls = this.constructor as object;
    if (!(await fireModelEvent(cls, "restoring", this))) return this;
    await db(ctor.table, ctor.connection)
      .where(ctor.primaryKey, this[ctor.primaryKey])
      .update({ [ctor.deletedAtColumn]: null });
    (this as Row)[ctor.deletedAtColumn] = null;
    await fireModelEvent(cls, "restored", this);
    return this;
  }

  /** Whether this soft-deletable model is currently trashed. */
  trashed(): boolean {
    const ctor = this.ctor();
    return ctor.softDeletes && (this as Row)[ctor.deletedAtColumn] != null;
  }

  /** Merge mass-assignable attributes into the model (cast, not saved). */
  fill(attributes: Row): this {
    const ctor = this.ctor();
    Object.assign(this, applyCasts(ctor.filterFillable(attributes), ctor.casts, castGet));
    return this;
  }

  /** Force-assign attributes, bypassing mass-assignment guarding (still cast). */
  forceFill(attributes: Row): this {
    const ctor = this.ctor();
    Object.assign(this, applyCasts(attributes, ctor.casts, castGet));
    return this;
  }

  toJSON(): Row {
    const ctor = this.ctor();
    let data: Row = applyCasts({ ...this }, ctor.casts, castGet);

    // Appended computed attributes: a getter (value) or a zero-arg method.
    for (const name of ctor.appends) {
      const value = (this as Row)[name];
      data[name] = typeof value === "function" ? (value as () => unknown).call(this) : value;
    }

    // `visible` is an allowlist and wins; otherwise `hidden` is a denylist.
    if (ctor.visible.length) {
      const kept: Row = {};
      for (const key of ctor.visible) if (key in data) kept[key] = data[key];
      data = kept;
    } else if (ctor.hidden.length) {
      for (const key of ctor.hidden) delete data[key];
    }

    const relations = relationStore.get(this);
    if (relations) {
      for (const [name, value] of Object.entries(relations)) data[name] = serialize(value);
    }
    return data;
  }
}
