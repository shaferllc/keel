/**
 * Model relationships over the query builder. Define a relationship as a method
 * on your model that returns one of these, then read it lazily (`await`) or
 * eager-load many at once with `Model.load()` to avoid N+1 queries.
 *
 *   class User extends Model {
 *     static table = "users";
 *     posts() { return this.hasMany(Post); }        // user_id on posts
 *     profile() { return this.hasOne(Profile); }
 *     roles() { return this.belongsToMany(Role); }  // role_user pivot
 *   }
 *   class Post extends Model {
 *     static table = "posts";
 *     author() { return this.belongsTo(User); }     // user_id on posts
 *   }
 *
 *   const posts = await user.posts();               // relations are awaitable
 *   const author = await post.author();
 *
 *   const users = await User.all();
 *   await User.load(users, "posts");                // one extra query, not N
 *   users[0].getRelation("posts");
 *
 * Every relation is edge-safe: it only uses the driver-agnostic query builder
 * (belongsToMany runs two `whereIn` reads instead of a JOIN).
 */

import { db, type QueryBuilder, type Row } from "./database.js";
import type { Model } from "./model.js";

type ModelClass<T extends Model> = (new (attributes?: Row) => T) & typeof Model;

function unique(values: unknown[]): unknown[] {
  return [...new Set(values)];
}

/** Count how many times each value appears — the basis of `withCount`. */
function tally(values: unknown[]): Map<unknown, number> {
  const counts = new Map<unknown, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** Base class: a relationship is awaitable (resolves to its loaded result). */
export abstract class Relation<TRelated extends Model, TResult> implements PromiseLike<TResult> {
  constructor(
    protected parent: Model,
    protected related: ModelClass<TRelated>,
  ) {}

  /** The query builder with the relationship constraint applied. */
  abstract query(): QueryBuilder;

  /** Load the relationship for this single parent. */
  abstract get(): Promise<TResult>;

  /** Batch-load this relationship onto many parents, then assign each result. */
  abstract eager(models: Model[], name: string): Promise<void>;

  then<R1 = TResult, R2 = never>(
    onFulfilled?: ((value: TResult) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.get().then(onFulfilled, onRejected);
  }

  protected hydrate(rows: Row[]): TRelated[] {
    return rows.map((row) => new this.related(row));
  }
}

/* --------------------------------- has-many -------------------------------- */

export class HasMany<T extends Model> extends Relation<T, T[]> {
  constructor(
    parent: Model,
    related: ModelClass<T>,
    private foreignKey: string,
    private localKey: string,
  ) {
    super(parent, related);
  }

  private localValue(): unknown {
    return (this.parent as Row)[this.localKey];
  }

  query(): QueryBuilder {
    return db(this.related.table, this.related.connection).where(this.foreignKey, this.localValue());
  }

  async get(): Promise<T[]> {
    return this.hydrate(await this.query().get());
  }

  async eager(models: Model[], name: string): Promise<void> {
    const keys = unique(models.map((m) => (m as Row)[this.localKey]).filter((v) => v != null));
    const rows = keys.length
      ? await db(this.related.table, this.related.connection).whereIn(this.foreignKey, keys).get()
      : [];

    const grouped = new Map<unknown, T[]>();
    for (const row of rows) {
      const bucket = grouped.get(row[this.foreignKey]) ?? [];
      bucket.push(new this.related(row));
      grouped.set(row[this.foreignKey], bucket);
    }
    for (const m of models) {
      m.setRelation(name, grouped.get((m as Row)[this.localKey]) ?? []);
    }
  }

  parentColumn(): string {
    return this.localKey;
  }

  async matchingParentKeys(constrain?: (q: QueryBuilder) => void): Promise<unknown[]> {
    const q = db(this.related.table, this.related.connection);
    constrain?.(q);
    return unique((await q.pluck(this.foreignKey)).filter((v) => v != null));
  }

  async countsByParent(parentKeys: unknown[]): Promise<Map<unknown, number>> {
    return tally(
      parentKeys.length
        ? await db(this.related.table, this.related.connection)
            .whereIn(this.foreignKey, parentKeys)
            .pluck(this.foreignKey)
        : [],
    );
  }
}

/* --------------------------------- has-one --------------------------------- */

export class HasOne<T extends Model> extends Relation<T, T | null> {
  constructor(
    parent: Model,
    related: ModelClass<T>,
    private foreignKey: string,
    private localKey: string,
  ) {
    super(parent, related);
  }

  private localValue(): unknown {
    return (this.parent as Row)[this.localKey];
  }

  query(): QueryBuilder {
    return db(this.related.table, this.related.connection).where(this.foreignKey, this.localValue());
  }

  async get(): Promise<T | null> {
    const row = await this.query().first();
    return row ? new this.related(row) : null;
  }

  async eager(models: Model[], name: string): Promise<void> {
    const keys = unique(models.map((m) => (m as Row)[this.localKey]).filter((v) => v != null));
    const rows = keys.length
      ? await db(this.related.table, this.related.connection).whereIn(this.foreignKey, keys).get()
      : [];

    const byKey = new Map<unknown, T>();
    for (const row of rows) {
      if (!byKey.has(row[this.foreignKey])) byKey.set(row[this.foreignKey], new this.related(row));
    }
    for (const m of models) {
      m.setRelation(name, byKey.get((m as Row)[this.localKey]) ?? null);
    }
  }

  parentColumn(): string {
    return this.localKey;
  }

  async matchingParentKeys(constrain?: (q: QueryBuilder) => void): Promise<unknown[]> {
    const q = db(this.related.table, this.related.connection);
    constrain?.(q);
    return unique((await q.pluck(this.foreignKey)).filter((v) => v != null));
  }

  async countsByParent(parentKeys: unknown[]): Promise<Map<unknown, number>> {
    return tally(
      parentKeys.length
        ? await db(this.related.table, this.related.connection)
            .whereIn(this.foreignKey, parentKeys)
            .pluck(this.foreignKey)
        : [],
    );
  }
}

/* -------------------------------- belongs-to ------------------------------- */

export class BelongsTo<T extends Model> extends Relation<T, T | null> {
  constructor(
    parent: Model,
    related: ModelClass<T>,
    private foreignKey: string,
    private ownerKey: string,
  ) {
    super(parent, related);
  }

  private foreignValue(): unknown {
    return (this.parent as Row)[this.foreignKey];
  }

  query(): QueryBuilder {
    return db(this.related.table, this.related.connection).where(this.ownerKey, this.foreignValue());
  }

  async get(): Promise<T | null> {
    if (this.foreignValue() == null) return null;
    const row = await this.query().first();
    return row ? new this.related(row) : null;
  }

  async eager(models: Model[], name: string): Promise<void> {
    const keys = unique(models.map((m) => (m as Row)[this.foreignKey]).filter((v) => v != null));
    const rows = keys.length
      ? await db(this.related.table, this.related.connection).whereIn(this.ownerKey, keys).get()
      : [];

    const byKey = new Map<unknown, T>();
    for (const row of rows) byKey.set(row[this.ownerKey], new this.related(row));
    for (const m of models) {
      m.setRelation(name, byKey.get((m as Row)[this.foreignKey]) ?? null);
    }
  }

  parentColumn(): string {
    return this.foreignKey;
  }

  async matchingParentKeys(constrain?: (q: QueryBuilder) => void): Promise<unknown[]> {
    const q = db(this.related.table, this.related.connection);
    constrain?.(q);
    return unique((await q.pluck(this.ownerKey)).filter((v) => v != null));
  }

  async countsByParent(parentKeys: unknown[]): Promise<Map<unknown, number>> {
    const existing = new Set(
      parentKeys.length
        ? await db(this.related.table, this.related.connection)
            .whereIn(this.ownerKey, parentKeys)
            .pluck(this.ownerKey)
        : [],
    );
    const counts = new Map<unknown, number>();
    for (const key of parentKeys) counts.set(key, existing.has(key) ? 1 : 0);
    return counts;
  }
}

/* ----------------------------- belongs-to-many ----------------------------- */

export class BelongsToMany<T extends Model> extends Relation<T, T[]> {
  constructor(
    parent: Model,
    related: ModelClass<T>,
    private pivotTable: string,
    private foreignPivotKey: string,
    private relatedPivotKey: string,
    private parentKey: string,
    private relatedKey: string,
  ) {
    super(parent, related);
  }

  private parentValue(): unknown {
    return (this.parent as Row)[this.parentKey];
  }

  /** The query against the related table, once pivot rows are known. */
  query(): QueryBuilder {
    return db(this.related.table, this.related.connection);
  }

  async get(): Promise<T[]> {
    if (this.parentValue() == null) return [];
    const pivots = await db(this.pivotTable, this.related.connection)
      .where(this.foreignPivotKey, this.parentValue())
      .get();
    const relatedIds = unique(pivots.map((p) => p[this.relatedPivotKey]));
    if (!relatedIds.length) return [];
    const rows = await db(this.related.table, this.related.connection).whereIn(this.relatedKey, relatedIds).get();
    return this.hydrate(rows);
  }

  async eager(models: Model[], name: string): Promise<void> {
    const parentIds = unique(
      models.map((m) => (m as Row)[this.parentKey]).filter((v) => v != null),
    );
    if (!parentIds.length) {
      for (const m of models) m.setRelation(name, []);
      return;
    }

    const pivots = await db(this.pivotTable, this.related.connection).whereIn(this.foreignPivotKey, parentIds).get();
    const relatedIds = unique(pivots.map((p) => p[this.relatedPivotKey]));
    const rows = relatedIds.length
      ? await db(this.related.table, this.related.connection).whereIn(this.relatedKey, relatedIds).get()
      : [];
    const relatedById = new Map(rows.map((row) => [row[this.relatedKey], row]));

    const grouped = new Map<unknown, T[]>();
    for (const pivot of pivots) {
      const row = relatedById.get(pivot[this.relatedPivotKey]);
      if (!row) continue;
      const bucket = grouped.get(pivot[this.foreignPivotKey]) ?? [];
      bucket.push(new this.related(row));
      grouped.set(pivot[this.foreignPivotKey], bucket);
    }
    for (const m of models) {
      m.setRelation(name, grouped.get((m as Row)[this.parentKey]) ?? []);
    }
  }

  /** Attach a related row by linking it through the pivot table. */
  async attach(id: unknown, extra: Row = {}): Promise<void> {
    await db(this.pivotTable, this.related.connection).insert({
      [this.foreignPivotKey]: this.parentValue(),
      [this.relatedPivotKey]: id,
      ...extra,
    });
  }

  /** Detach one related row (or all, when no id is given). */
  async detach(id?: unknown): Promise<void> {
    let q = db(this.pivotTable, this.related.connection).where(this.foreignPivotKey, this.parentValue());
    if (id !== undefined) q = q.where(this.relatedPivotKey, id);
    await q.delete();
  }

  /** Make the pivot contain exactly `ids` (detach the rest, attach the new). */
  async sync(ids: unknown[]): Promise<void> {
    await this.detach();
    for (const id of ids) await this.attach(id);
  }

  parentColumn(): string {
    return this.parentKey;
  }

  async matchingParentKeys(constrain?: (q: QueryBuilder) => void): Promise<unknown[]> {
    const rq = db(this.related.table, this.related.connection);
    constrain?.(rq);
    const relatedIds = unique((await rq.pluck(this.relatedKey)).filter((v) => v != null));
    if (!relatedIds.length) return [];
    const pivots = await db(this.pivotTable, this.related.connection)
      .whereIn(this.relatedPivotKey, relatedIds)
      .pluck(this.foreignPivotKey);
    return unique(pivots.filter((v) => v != null));
  }

  async countsByParent(parentKeys: unknown[]): Promise<Map<unknown, number>> {
    return tally(
      parentKeys.length
        ? await db(this.pivotTable, this.related.connection)
            .whereIn(this.foreignPivotKey, parentKeys)
            .pluck(this.foreignPivotKey)
        : [],
    );
  }
}

/* ----------------------------- polymorphic --------------------------------- */

/** Maps a stored morph-type string to its model class, so `morphTo` can resolve it. */
const morphRegistry = new Map<string, ModelClass<Model>>();

/** Register a model under a morph type string (usually its class name). */
export function registerMorphType(type: string, related: ModelClass<Model>): void {
  morphRegistry.set(type, related);
}

/** The parent side of a polymorphic one-to-many (`Post.comments()` over `commentable`). */
export class MorphMany<T extends Model> extends Relation<T, T[]> {
  constructor(
    parent: Model,
    related: ModelClass<T>,
    private morphType: string,
    private idColumn: string,
    private typeColumn: string,
    private localKey: string,
  ) {
    super(parent, related);
  }

  private localValue(): unknown {
    return (this.parent as Row)[this.localKey];
  }

  query(): QueryBuilder {
    return db(this.related.table, this.related.connection)
      .where(this.typeColumn, this.morphType)
      .where(this.idColumn, this.localValue());
  }

  async get(): Promise<T[]> {
    return this.hydrate(await this.query().get());
  }

  async eager(models: Model[], name: string): Promise<void> {
    const keys = unique(models.map((m) => (m as Row)[this.localKey]).filter((v) => v != null));
    const rows = keys.length
      ? await db(this.related.table, this.related.connection)
          .where(this.typeColumn, this.morphType)
          .whereIn(this.idColumn, keys)
          .get()
      : [];
    const grouped = new Map<unknown, T[]>();
    for (const row of rows) {
      const bucket = grouped.get(row[this.idColumn]) ?? [];
      bucket.push(new this.related(row));
      grouped.set(row[this.idColumn], bucket);
    }
    for (const m of models) m.setRelation(name, grouped.get((m as Row)[this.localKey]) ?? []);
  }

  parentColumn(): string {
    return this.localKey;
  }

  async matchingParentKeys(constrain?: (q: QueryBuilder) => void): Promise<unknown[]> {
    const q = db(this.related.table, this.related.connection).where(this.typeColumn, this.morphType);
    constrain?.(q);
    return unique((await q.pluck(this.idColumn)).filter((v) => v != null));
  }

  async countsByParent(parentKeys: unknown[]): Promise<Map<unknown, number>> {
    return tally(
      parentKeys.length
        ? await db(this.related.table, this.related.connection)
            .where(this.typeColumn, this.morphType)
            .whereIn(this.idColumn, parentKeys)
            .pluck(this.idColumn)
        : [],
    );
  }

  /** Create a related row with the morph keys (`*_id` / `*_type`) filled in. */
  create(attributes: Row): Promise<T> {
    return this.related.create({
      ...attributes,
      [this.idColumn]: this.localValue(),
      [this.typeColumn]: this.morphType,
    }) as Promise<T>;
  }
}

/** The parent side of a polymorphic one-to-one. */
export class MorphOne<T extends Model> extends Relation<T, T | null> {
  constructor(
    parent: Model,
    related: ModelClass<T>,
    private morphType: string,
    private idColumn: string,
    private typeColumn: string,
    private localKey: string,
  ) {
    super(parent, related);
  }

  query(): QueryBuilder {
    return db(this.related.table, this.related.connection)
      .where(this.typeColumn, this.morphType)
      .where(this.idColumn, (this.parent as Row)[this.localKey]);
  }

  async get(): Promise<T | null> {
    const row = await this.query().first();
    return row ? new this.related(row) : null;
  }

  async eager(models: Model[], name: string): Promise<void> {
    const keys = unique(models.map((m) => (m as Row)[this.localKey]).filter((v) => v != null));
    const rows = keys.length
      ? await db(this.related.table, this.related.connection)
          .where(this.typeColumn, this.morphType)
          .whereIn(this.idColumn, keys)
          .get()
      : [];
    const byKey = new Map<unknown, T>();
    for (const row of rows) if (!byKey.has(row[this.idColumn])) byKey.set(row[this.idColumn], new this.related(row));
    for (const m of models) m.setRelation(name, byKey.get((m as Row)[this.localKey]) ?? null);
  }
}

/** The owning side of a polymorphic relation — resolves its parent by stored type + id. */
export class MorphTo implements PromiseLike<Model | null> {
  constructor(
    private parent: Model,
    private idColumn: string,
    private typeColumn: string,
  ) {}

  private relatedClass(): ModelClass<Model> | undefined {
    const type = (this.parent as Row)[this.typeColumn] as string | undefined;
    return type ? morphRegistry.get(type) : undefined;
  }

  async get(): Promise<Model | null> {
    const cls = this.relatedClass();
    const id = (this.parent as Row)[this.idColumn];
    if (!cls || id == null) return null;
    const row = await db(cls.table, cls.connection).where(cls.primaryKey, id).first();
    return row ? new cls(row) : null;
  }

  async eager(models: Model[], name: string): Promise<void> {
    const byType = new Map<string, Model[]>();
    for (const m of models) {
      const type = (m as Row)[this.typeColumn] as string | undefined;
      if (!type) {
        m.setRelation(name, null);
        continue;
      }
      const group = byType.get(type) ?? [];
      group.push(m);
      byType.set(type, group);
    }
    for (const [type, group] of byType) {
      const cls = morphRegistry.get(type);
      if (!cls) {
        for (const m of group) m.setRelation(name, null);
        continue;
      }
      const ids = unique(group.map((m) => (m as Row)[this.idColumn]).filter((v) => v != null));
      const rows = ids.length ? await db(cls.table, cls.connection).whereIn(cls.primaryKey, ids).get() : [];
      const byId = new Map(rows.map((row) => [row[cls.primaryKey], row]));
      for (const m of group) {
        const row = byId.get((m as Row)[this.idColumn]);
        m.setRelation(name, row ? new cls(row) : null);
      }
    }
  }

  then<R1 = Model | null, R2 = never>(
    onFulfilled?: ((value: Model | null) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.get().then(onFulfilled, onRejected);
  }
}
