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

type ModelClass<T extends Model> = (new (attributes?: Row) => T) & typeof Model;

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

  /* ----------------------------- instance ------------------------------- */

  private ctor(): typeof Model {
    return this.constructor as typeof Model;
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
    return { ...this };
  }
}
