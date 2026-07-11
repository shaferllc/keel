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

  [key: string]: unknown;

  constructor(attributes: Row = {}) {
    // Hydration is unguarded (rows come from the database) but always cast.
    Object.assign(this, applyCasts(attributes, (this.constructor as typeof Model).casts, castGet));
  }

  /* ------------------------------ static -------------------------------- */

  /** A raw query builder scoped to this model's table. */
  static query(): QueryBuilder {
    return db(this.table, this.connection);
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
    const rows = await db(this.table, this.connection).get();
    return rows.map((row) => new this(row));
  }

  static async find<T extends Model>(this: ModelClass<T>, id: unknown): Promise<T | null> {
    const row = await db(this.table, this.connection).where(this.primaryKey, id).first();
    return row ? new this(row) : null;
  }

  static async findOrFail<T extends Model>(this: ModelClass<T>, id: unknown): Promise<T> {
    const model = await (this as ModelClass<T>).find(id);
    if (!model) throw new NotFoundException(`${this.name} ${String(id)} not found`);
    return model;
  }

  static async first<T extends Model>(this: ModelClass<T>): Promise<T | null> {
    const row = await db(this.table, this.connection).first();
    return row ? new this(row) : null;
  }

  /** Fetch models matching a simple equality condition. */
  static async where<T extends Model>(
    this: ModelClass<T>,
    column: string,
    value: unknown,
  ): Promise<T[]> {
    const rows = await db(this.table, this.connection).where(column, value).get();
    return rows.map((row) => new this(row));
  }

  static async create<T extends Model>(this: ModelClass<T>, attributes: Row): Promise<T> {
    const filtered = this.filterFillable(attributes);
    const write = this.stampTimestamps(this.toDatabase(filtered), true);
    const id = await db(this.table, this.connection).insertGetId(write);
    const model = new this(filtered);
    if (this.timestamps) {
      (model as Row)[this.createdAtColumn] = write[this.createdAtColumn];
      (model as Row)[this.updatedAtColumn] = write[this.updatedAtColumn];
    }
    if (id != null) (model as Row)[this.primaryKey] = id;
    return model;
  }

  /** A page of models plus pagination metadata. */
  static async paginate<T extends Model>(
    this: ModelClass<T>,
    page = 1,
    perPage = 15,
  ): Promise<Paginated<T>> {
    const result = await db(this.table, this.connection).paginate(page, perPage);
    return { ...result, data: result.data.map((row) => new this(row)) };
  }

  /** Find the first row matching `match`, or create one from `{ ...match, ...values }`. */
  static async firstOrCreate<T extends Model>(
    this: ModelClass<T>,
    match: Row,
    values: Row = {},
  ): Promise<T> {
    const row = await this.matching(match).first();
    if (row) return new this(row);
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
      const model = new this(row);
      await model.forceFill(values).save();
      return model;
    }
    return (this as ModelClass<T>).create({ ...match, ...values });
  }

  /** A query scoped to every column/value in `match`. */
  private static matching(match: Row): QueryBuilder {
    let q = db(this.table, this.connection);
    for (const [column, value] of Object.entries(match)) q = q.where(column, value);
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

  /** Insert (no primary key) or update (has one). */
  async save(): Promise<this> {
    const ctor = this.ctor();
    const { table, primaryKey, connection } = ctor;
    const idValue = (this as Row)[primaryKey];
    const forInsert = idValue == null;

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

  async delete(): Promise<void> {
    const { table, primaryKey, connection } = this.ctor();
    await db(table, connection).where(primaryKey, this[primaryKey]).delete();
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
    const data: Row = applyCasts({ ...this }, this.ctor().casts, castGet);
    const relations = relationStore.get(this);
    if (relations) {
      for (const [name, value] of Object.entries(relations)) data[name] = serialize(value);
    }
    return data;
  }
}
