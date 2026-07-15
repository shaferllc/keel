/**
 * Feature flags. Define a flag once — a value, or a resolver that decides per
 * scope (a user, a team, anything) — then ask `feature()` anywhere. The first
 * resolution for a scope is **persisted**, so a user who saw the new thing
 * keeps seeing it while you ramp up, and flipping them back is an explicit
 * `deactivate`, not a resolver edit racing their next request.
 *
 *   features().define("new-billing", (user) => user.plan === "pro");
 *   features().define("dark-mode", true);
 *
 *   if (await feature("new-billing", user)) { … }
 *
 *   await features().activate("new-billing", user);     // force on, this user
 *   await features().deactivate("new-billing");         // force off, globally
 *   await features().forget("new-billing", user);       // back to the resolver
 *
 * Storage follows the queue and cache: an in-memory store by default (per
 * process — right for dev and tests), a `DatabaseFlagStore` when a rollout must
 * be shared and survive a deploy. Values are JSON, not just booleans, so a flag
 * can carry a variant name or a limit; `active()` is simply "truthy".
 */

import { db } from "./database.js";

/** Whom a flag is being decided for. `null` means "globally". */
export type FlagScope = unknown;

/** Decides a flag's value for a scope. Return a boolean or any JSON value. */
export type FlagResolver = (scope: FlagScope) => unknown | Promise<unknown>;

/** Where resolved values and overrides live — implement once per backend. */
export interface FlagStore {
  get(feature: string, scopeKey: string): Promise<unknown> | unknown;
  set(feature: string, scopeKey: string, value: unknown): Promise<void> | void;
  delete(feature: string, scopeKey: string): Promise<void> | void;
  /** Drop every stored value for a feature (or all features, with no argument). */
  purge(feature?: string): Promise<void> | void;
}

/** The default per-process store. */
export class MemoryFlagStore implements FlagStore {
  private data = new Map<string, unknown>();

  private k(feature: string, scopeKey: string): string {
    return `${feature}\n${scopeKey}`;
  }

  get(feature: string, scopeKey: string): unknown {
    return this.data.get(this.k(feature, scopeKey));
  }
  set(feature: string, scopeKey: string, value: unknown): void {
    this.data.set(this.k(feature, scopeKey), value);
  }
  delete(feature: string, scopeKey: string): void {
    this.data.delete(this.k(feature, scopeKey));
  }
  purge(feature?: string): void {
    if (feature === undefined) return void this.data.clear();
    for (const key of this.data.keys()) if (key.startsWith(`${feature}\n`)) this.data.delete(key);
  }
}

/**
 * Flags as rows — the shared store that works anywhere a `Connection` does.
 * Add `flagsMigration()` to your migrations.
 */
export class DatabaseFlagStore implements FlagStore {
  constructor(private options: { table?: string; connection?: string } = {}) {}

  private query() {
    return db(this.options.table ?? "features", this.options.connection);
  }

  async get(feature: string, scopeKey: string): Promise<unknown> {
    const row = await this.query().where("name", feature).where("scope", scopeKey).first();
    return row ? JSON.parse(String(row.value)) : undefined;
  }

  async set(feature: string, scopeKey: string, value: unknown): Promise<void> {
    await this.query().updateOrInsert(
      { name: feature, scope: scopeKey },
      { value: JSON.stringify(value), updated_at: Date.now() },
    );
  }

  async delete(feature: string, scopeKey: string): Promise<void> {
    await this.query().where("name", feature).where("scope", scopeKey).delete();
  }

  async purge(feature?: string): Promise<void> {
    const query = feature === undefined ? this.query() : this.query().where("name", feature);
    await query.delete();
  }
}

/** Schema for the database store's table — add it to your migrations. */
export function flagsMigration(table = "features"): import("./migrations.js").Migration {
  return {
    name: `flags_00_${table}`,
    async up(schema) {
      await schema.createTable(table, (t) => {
        t.string("name");
        t.string("scope");
        t.text("value");
        t.bigInteger("updated_at").nullable();
        t.uniqueIndex(["name", "scope"]);
      });
    },
    async down(schema) {
      await schema.dropTable(table);
    },
  };
}

/**
 * A stable string for a scope: null is global, primitives are themselves, and
 * an object is its class plus its `id` — so `User#7` today matches `User#7`
 * tomorrow. An object with no id has no stable identity; refuse it rather than
 * silently keying every request differently.
 */
export function flagScopeKey(scope: FlagScope): string {
  if (scope == null) return "__global";
  if (typeof scope === "string" || typeof scope === "number" || typeof scope === "boolean") {
    return String(scope);
  }
  const id = (scope as { id?: unknown }).id;
  if (id == null) {
    throw new Error(
      "features: a flag scope must be null, a primitive, or an object with an `id` — got one without.",
    );
  }
  return `${(scope as object).constructor.name}:${String(id)}`;
}

export class Features {
  private resolvers = new Map<string, FlagResolver>();

  constructor(private store: FlagStore = new MemoryFlagStore()) {}

  /** Register a flag: a fixed value, or a resolver deciding per scope. */
  define(name: string, resolver: FlagResolver): this;
  define(name: string, value?: unknown): this;
  define(name: string, valueOrResolver: unknown = true): this {
    const resolver =
      typeof valueOrResolver === "function"
        ? (valueOrResolver as FlagResolver)
        : () => valueOrResolver;
    this.resolvers.set(name, resolver);
    return this;
  }

  /** The names of every defined flag. */
  defined(): string[] {
    return [...this.resolvers.keys()];
  }

  /**
   * The flag's value for a scope: the stored value if one exists (an override,
   * or an earlier resolution), else the resolver's answer — persisted, so the
   * scope keeps getting it. An undefined flag is `false`, not an error: code
   * behind a flag nobody defined is simply off.
   */
  async value(name: string, scope: FlagScope = null): Promise<unknown> {
    const key = flagScopeKey(scope);
    const stored = await this.store.get(name, key);
    if (stored !== undefined) return stored;

    const resolver = this.resolvers.get(name);
    if (!resolver) return false;

    const resolved = await resolver(scope);
    await this.store.set(name, key, resolved ?? false);
    return resolved ?? false;
  }

  /** Whether the flag is on (truthy) for a scope. */
  async active(name: string, scope: FlagScope = null): Promise<boolean> {
    return Boolean(await this.value(name, scope));
  }

  /** The inverse of `active`. */
  async inactive(name: string, scope: FlagScope = null): Promise<boolean> {
    return !(await this.active(name, scope));
  }

  /** Force a flag on for a scope (or globally) — optionally with a rich value. */
  async activate(name: string, scope: FlagScope = null, value: unknown = true): Promise<void> {
    await this.store.set(name, flagScopeKey(scope), value);
  }

  /** Force a flag off for a scope (or globally). */
  async deactivate(name: string, scope: FlagScope = null): Promise<void> {
    await this.store.set(name, flagScopeKey(scope), false);
  }

  /** Drop the stored value so the resolver decides afresh next time. */
  async forget(name: string, scope: FlagScope = null): Promise<void> {
    await this.store.delete(name, flagScopeKey(scope));
  }

  /** Drop every stored value for a flag (or for all of them). */
  async purge(name?: string): Promise<void> {
    await this.store.purge(name);
  }
}

/* --------------------------------- global --------------------------------- */

let instance = new Features();

/** Swap the store (or the whole instance) behind `features()`. */
export function setFeatures(storeOrInstance: FlagStore | Features): Features {
  instance = storeOrInstance instanceof Features ? storeOrInstance : new Features(storeOrInstance);
  return instance;
}

/** The default `Features` instance. */
export function features(): Features {
  return instance;
}

/** Shorthand: is this flag on for this scope? */
export function feature(name: string, scope: FlagScope = null): Promise<boolean> {
  return instance.active(name, scope);
}
