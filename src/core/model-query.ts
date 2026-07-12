/**
 * A model-aware query builder — what `Model.query()` sugar and eager loading are
 * built on. It wraps the plain `QueryBuilder`, hydrates rows into models (firing
 * `retrieved`), and adds the relationship-aware operations Eloquent has and a raw
 * builder can't: `with()` (nested eager loading), `withCount()`, and existence
 * filters `has()` / `whereHas()` / `doesntHave()`.
 *
 *   const users = await User.query()
 *     .where("active", true)
 *     .with("posts.comments")
 *     .withCount("posts")
 *     .whereHas("posts", (q) => q.where("published", true))
 *     .get();
 *
 * Existence filters use the same two-query strategy as the relations themselves
 * (a `whereIn` over keys gathered from the related table), so everything stays on
 * the driver-agnostic builder — no JOIN or correlated subquery required. They're
 * recorded and resolved at `get()`/`first()`/`count()` time so the chain stays
 * synchronous.
 */

import type { QueryBuilder, Row, Paginated } from "./database.js";
import type { Model } from "./model.js";
import { fireModelEvent } from "./model-events.js";

type ModelClass<T extends Model> = new (attributes?: Row) => T;

/** The relation surface `ModelQuery` needs — satisfied by every relation class. */
interface ExistenceRelation {
  parentColumn(): string;
  matchingParentKeys(constrain?: (q: QueryBuilder) => void): Promise<unknown[]>;
  countsByParent(parentKeys: unknown[]): Promise<Map<unknown, number>>;
  eager(models: Model[], name: string): Promise<void>;
}

type Constrain = (q: QueryBuilder) => void;
interface HasConstraint {
  name: string;
  constrain?: Constrain;
  negate: boolean;
}

/** Group dotted eager-load paths by their first segment. */
function groupPaths(paths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const [top, ...rest] = path.split(".");
    const nested = groups.get(top!) ?? [];
    if (rest.length) nested.push(rest.join("."));
    groups.set(top!, nested);
  }
  return groups;
}

/** Recursively eager-load dotted relation paths onto a set of models. */
async function eagerLoad(models: Model[], paths: string[]): Promise<void> {
  if (!models.length) return;
  for (const [top, nested] of groupPaths(paths)) {
    const relation = (models[0] as unknown as Record<string, () => ExistenceRelation>)[top]?.();
    if (!relation) throw new Error(`${models[0]!.constructor.name} has no relation "${top}"`);
    await relation.eager(models, top);
    if (nested.length) {
      const children: Model[] = [];
      for (const model of models) {
        const loaded = model.getRelation(top);
        if (Array.isArray(loaded)) children.push(...(loaded as Model[]));
        else if (loaded) children.push(loaded as Model);
      }
      await eagerLoad(children, nested);
    }
  }
}

export class ModelQuery<T extends Model> {
  private eagers: string[] = [];
  private counts: string[] = [];
  private hasConstraints: HasConstraint[] = [];

  constructor(
    private cls: ModelClass<T>,
    private builder: QueryBuilder,
  ) {}

  /** The wrapped builder, for anything `ModelQuery` doesn't proxy. */
  toBase(): QueryBuilder {
    return this.builder;
  }

  /* --------------------------- builder passthrough --------------------------- */

  where(column: string, opOrValue: unknown, value?: unknown): this {
    if (value === undefined) this.builder.where(column, opOrValue);
    else this.builder.where(column, opOrValue as never, value);
    return this;
  }
  orWhere(column: string, opOrValue: unknown, value?: unknown): this {
    if (value === undefined) this.builder.orWhere(column, opOrValue);
    else this.builder.orWhere(column, opOrValue as never, value);
    return this;
  }
  whereIn(column: string, values: unknown[]): this {
    this.builder.whereIn(column, values);
    return this;
  }
  whereNotIn(column: string, values: unknown[]): this {
    this.builder.whereNotIn(column, values);
    return this;
  }
  whereNull(column: string): this {
    this.builder.whereNull(column);
    return this;
  }
  whereNotNull(column: string): this {
    this.builder.whereNotNull(column);
    return this;
  }
  whereBetween(column: string, range: [unknown, unknown]): this {
    this.builder.whereBetween(column, range);
    return this;
  }
  whereLike(column: string, pattern: string): this {
    this.builder.whereLike(column, pattern);
    return this;
  }
  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    this.builder.orderBy(column, direction);
    return this;
  }
  latest(column = "created_at"): this {
    this.builder.latest(column);
    return this;
  }
  oldest(column = "created_at"): this {
    this.builder.oldest(column);
    return this;
  }
  limit(n: number): this {
    this.builder.limit(n);
    return this;
  }
  offset(n: number): this {
    this.builder.offset(n);
    return this;
  }

  /* ---------------------------- relationship ops ----------------------------- */

  /** Eager-load relations (dotted paths for nesting: `"posts.comments"`). */
  with(...names: string[]): this {
    this.eagers.push(...names);
    return this;
  }

  /** Add a `<relation>_count` to each result. */
  withCount(...names: string[]): this {
    this.counts.push(...names);
    return this;
  }

  /** Constrain to models that have at least one related row. */
  has(name: string): this {
    this.hasConstraints.push({ name, negate: false });
    return this;
  }

  /** Constrain to models whose related rows match `constrain`. */
  whereHas(name: string, constrain?: Constrain): this {
    this.hasConstraints.push({ name, ...(constrain ? { constrain } : {}), negate: false });
    return this;
  }

  /** Constrain to models with no matching related row. */
  doesntHave(name: string, constrain?: Constrain): this {
    this.hasConstraints.push({ name, ...(constrain ? { constrain } : {}), negate: true });
    return this;
  }

  /* -------------------------------- terminals -------------------------------- */

  async get(): Promise<T[]> {
    await this.resolveHasConstraints();
    const rows = await this.builder.get();
    const models = await Promise.all(rows.map((row) => this.hydrate(row)));
    if (this.eagers.length) await eagerLoad(models, this.eagers);
    if (this.counts.length) await this.loadCounts(models);
    return models;
  }

  async first(): Promise<T | null> {
    this.builder.limit(1);
    const [model] = await this.get();
    return model ?? null;
  }

  async count(): Promise<number> {
    await this.resolveHasConstraints();
    return this.builder.count();
  }

  async exists(): Promise<boolean> {
    return (await this.count()) > 0;
  }

  async paginate(page = 1, perPage = 15): Promise<Paginated<T>> {
    await this.resolveHasConstraints();
    const result = await this.builder.paginate(page, perPage);
    const data = await Promise.all(result.data.map((row) => this.hydrate(row as Row)));
    if (this.eagers.length) await eagerLoad(data, this.eagers);
    if (this.counts.length) await this.loadCounts(data);
    return { ...result, data };
  }

  /* -------------------------------- internals -------------------------------- */

  private async hydrate(row: Row): Promise<T> {
    const model = new this.cls(row);
    await fireModelEvent(this.cls as object, "retrieved", model);
    return model;
  }

  private relationFor(name: string): ExistenceRelation {
    const probe = new this.cls() as unknown as Record<string, () => ExistenceRelation>;
    const method = probe[name];
    if (typeof method !== "function") {
      throw new Error(`${(this.cls as { name: string }).name} has no relation "${name}"`);
    }
    return method.call(probe);
  }

  /** Turn recorded has/doesntHave constraints into `whereIn`/`whereNotIn` on the builder. */
  private async resolveHasConstraints(): Promise<void> {
    for (const { name, constrain, negate } of this.hasConstraints) {
      const relation = this.relationFor(name);
      const keys = await relation.matchingParentKeys(constrain);
      const column = relation.parentColumn();
      if (negate) {
        if (keys.length) this.builder.whereNotIn(column, keys);
      } else if (keys.length) {
        this.builder.whereIn(column, keys);
      } else {
        // No related rows exist → nothing can match. A contradiction yields zero
        // rows without an invalid empty `IN ()`.
        this.builder.whereNull(column).whereNotNull(column);
      }
    }
    this.hasConstraints = [];
  }

  private async loadCounts(models: T[]): Promise<void> {
    for (const name of this.counts) {
      const relation = this.relationFor(name);
      const column = relation.parentColumn();
      const keys = [...new Set(models.map((m) => (m as Row)[column]).filter((v) => v != null))];
      const counts = await relation.countsByParent(keys);
      for (const model of models) {
        (model as Row)[`${name}_count`] = counts.get((model as Row)[column]) ?? 0;
      }
    }
  }
}
