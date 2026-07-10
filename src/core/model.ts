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

import { db, type QueryBuilder, type Row } from "./database.js";
import { NotFoundException } from "./exceptions.js";
import { BelongsTo, BelongsToMany, HasMany, HasOne } from "./relations.js";

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

  [key: string]: unknown;

  constructor(attributes: Row = {}) {
    Object.assign(this, attributes);
  }

  /* ------------------------------ static -------------------------------- */

  /** A raw query builder scoped to this model's table. */
  static query(): QueryBuilder {
    return db(this.table);
  }

  static async all<T extends Model>(this: ModelClass<T>): Promise<T[]> {
    const rows = await db(this.table).get();
    return rows.map((row) => new this(row));
  }

  static async find<T extends Model>(this: ModelClass<T>, id: unknown): Promise<T | null> {
    const row = await db(this.table).where(this.primaryKey, id).first();
    return row ? new this(row) : null;
  }

  static async findOrFail<T extends Model>(this: ModelClass<T>, id: unknown): Promise<T> {
    const model = await (this as ModelClass<T>).find(id);
    if (!model) throw new NotFoundException(`${this.name} ${String(id)} not found`);
    return model;
  }

  static async first<T extends Model>(this: ModelClass<T>): Promise<T | null> {
    const row = await db(this.table).first();
    return row ? new this(row) : null;
  }

  /** Fetch models matching a simple equality condition. */
  static async where<T extends Model>(
    this: ModelClass<T>,
    column: string,
    value: unknown,
  ): Promise<T[]> {
    const rows = await db(this.table).where(column, value).get();
    return rows.map((row) => new this(row));
  }

  static async create<T extends Model>(this: ModelClass<T>, attributes: Row): Promise<T> {
    const id = await db(this.table).insertGetId(attributes);
    const model = new this(attributes);
    if (id != null) (model as Row)[this.primaryKey] = id;
    return model;
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
    const { table, primaryKey } = this.ctor();
    const data: Row = { ...this };
    const idValue = data[primaryKey];
    delete data[primaryKey];

    if (idValue != null) {
      await db(table).where(primaryKey, idValue).update(data);
    } else {
      const id = await db(table).insertGetId(data);
      if (id != null) (this as Row)[primaryKey] = id;
    }
    return this;
  }

  async delete(): Promise<void> {
    const { table, primaryKey } = this.ctor();
    await db(table).where(primaryKey, this[primaryKey]).delete();
  }

  /** Merge attributes into the model (without saving). */
  fill(attributes: Row): this {
    Object.assign(this, attributes);
    return this;
  }

  toJSON(): Row {
    const data: Row = { ...this };
    const relations = relationStore.get(this);
    if (relations) {
      for (const [name, value] of Object.entries(relations)) data[name] = serialize(value);
    }
    return data;
  }
}
