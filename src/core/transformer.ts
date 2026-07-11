/**
 * Transformers — a presentation layer between your models and your JSON. A model
 * knows the database; a transformer knows the API. Subclass `Transformer`, define
 * one `transform()` that maps a value to the exact shape you want to expose, and
 * get `item` / `collection` / `document` for free.
 *
 *   class UserTransformer extends Transformer<User> {
 *     transform(user: User) {
 *       return {
 *         id: user.id,
 *         name: user.name,
 *         email: this.when(user.id === viewerId, user.email),   // omit for others
 *         posts: this.whenLoaded(user, "posts", new PostTransformer()),
 *       };
 *     }
 *   }
 *
 *   json(new UserTransformer().item(user));                 // one → {…}
 *   json(new UserTransformer().collection(users));          // many → [{…}]
 *   json(new UserTransformer().document(users, {            // wrapped + meta
 *     meta: { total: users.length },
 *   }));                                                    // → { data: [{…}], total }
 *
 * The seam is deliberately thin: a transformer is just a function with helpers.
 * `when` drops a key entirely when a condition is false (no `null` leaking into
 * the payload), and `whenLoaded` includes a relation only if it was eager-loaded
 * — so a transformer never triggers a surprise query. It leans on nothing but the
 * value you hand it, so it runs on Node and the edge alike.
 */

/** The shape a transformer produces — a plain, JSON-ready object. */
export type Attributes = Record<string, unknown>;

/**
 * The sentinel a helper returns to mean "leave this key out". `item`/`collection`
 * prune it before the payload is ever seen, so `{ email: this.when(false, …) }`
 * yields `{}` rather than `{ email: undefined }`.
 */
const OMIT = Symbol("keel.transformer.omit");

/** Options for `document()` — how to wrap the payload and what meta to attach. */
export interface DocumentOptions {
  /** Wrap the payload under this key. `null` disables wrapping. Defaults to `wrapKey`. */
  key?: string | null;
  /** Top-level fields merged alongside the wrapper — pagination, counts, links. */
  meta?: Attributes;
}

/** A transformer for a related value: another transformer, or a plain mapping fn. */
type Related = Transformer<never> | ((value: never) => unknown);

export abstract class Transformer<T = unknown> {
  /** The key `document()` wraps under by default. Set to `null` to wrap nothing. */
  wrapKey: string | null = "data";

  /** Map one value to its API shape. The only method a subclass must implement. */
  abstract transform(item: T): Attributes;

  /** Transform a single value (a nullish value passes straight through as `null`). */
  item(value: T | null | undefined): Attributes | null {
    return value == null ? null : (this.prune(this.transform(value)) as Attributes);
  }

  /** Transform an array of values, each through `transform`. */
  collection(values: T[]): Attributes[] {
    return values.map((value) => this.prune(this.transform(value)) as Attributes);
  }

  /**
   * Build a response document: the transformed payload wrapped under a key, with
   * optional top-level `meta`. Pass a single value or an array — arrays become a
   * list under the key, everything else a single object.
   *
   *   new UserTransformer().document(users, { meta: { total: 3 } });
   *   // → { data: [{…}, {…}, {…}], total: 3 }
   */
  document(value: T | T[] | null | undefined, options: DocumentOptions = {}): Attributes {
    const key = options.key !== undefined ? options.key : this.wrapKey;
    const meta = options.meta ?? {};
    const payload = Array.isArray(value) ? this.collection(value) : this.item(value);

    if (key) return { [key]: payload, ...meta };
    // No wrapper: merge a single object's fields to the top level. An array can't
    // share the top level with meta, so it still gets a `data` home.
    if (payload && !Array.isArray(payload)) return { ...payload, ...meta };
    return { data: payload, ...meta };
  }

  /* ------------------------------- helpers -------------------------------- */

  /**
   * Include `value` only when `condition` is truthy; otherwise omit the key (or
   * use `fallback` if you pass one). `value` may be a thunk, deferred until the
   * condition holds — handy when computing it is expensive.
   *
   *   { email: this.when(isSelf, user.email) }          // key vanishes for others
   *   { token: this.when(fresh, () => mint(), null) }   // explicit fallback
   */
  protected when<V>(condition: unknown, value: V | (() => V), fallback?: V): V {
    if (condition) return typeof value === "function" ? (value as () => V)() : value;
    return (arguments.length >= 3 ? fallback : OMIT) as V;
  }

  /**
   * Spread several keys in at once, but only when `condition` holds — the merge
   * counterpart to `when`. Returns `{}` when false, so `...mergeWhen(…)` adds
   * nothing.
   *
   *   return { id: u.id, ...this.mergeWhen(isAdmin, { role: u.role, flags: u.flags }) };
   */
  protected mergeWhen(condition: unknown, values: Attributes | (() => Attributes)): Attributes {
    if (!condition) return {};
    return typeof values === "function" ? values() : values;
  }

  /**
   * Include a relation only if it was already loaded — never fires a query. Reads
   * an eager-loaded relation off a Keel model (via `getRelation`) or a plain
   * property, and, if present, runs it through `map` (a transformer or a function).
   * Omits the key when the relation isn't loaded.
   *
   *   posts: this.whenLoaded(user, "posts", new PostTransformer()),
   *   roles: this.whenLoaded(user, "roles", (rs) => rs.map((r) => r.name)),
   */
  protected whenLoaded<V>(model: unknown, name: string, map?: Related): V {
    const related = readRelation(model, name);
    if (related === undefined) return OMIT as V;
    if (map instanceof Transformer) {
      const via = map as Transformer<unknown>;
      return (Array.isArray(related) ? via.collection(related) : via.item(related)) as V;
    }
    if (typeof map === "function") return (map as (value: unknown) => unknown)(related) as V;
    return related as V;
  }

  /* ------------------------------ internals ------------------------------- */

  /** Recursively drop `OMIT` keys/elements so the payload is clean, plain JSON. */
  private prune(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.filter((entry) => entry !== OMIT).map((entry) => this.prune(entry));
    }
    if (isPlainObject(value)) {
      const out: Attributes = {};
      for (const [key, entry] of Object.entries(value)) {
        if (entry === OMIT) continue;
        out[key] = this.prune(entry);
      }
      return out;
    }
    return value;
  }
}

/** Read an eager-loaded relation without ever querying: `getRelation`, then a plain prop. */
function readRelation(model: unknown, name: string): unknown {
  if (model && typeof model === "object") {
    const record = model as Record<string, unknown>;
    if (typeof record.getRelation === "function") {
      return (record.getRelation as (relation: string) => unknown)(name);
    }
    const value = record[name];
    // A relation *method* isn't a loaded value — only a stored result counts.
    if (typeof value !== "function") return value;
  }
  return undefined;
}

/** True for object literals (and `Object.create(null)`) — not class instances, arrays, or Dates. */
function isPlainObject(value: unknown): value is Attributes {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
