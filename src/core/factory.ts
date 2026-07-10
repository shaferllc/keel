/**
 * Factories and seeders for populating the database in tests and demos. A
 * factory describes how to build a model's attributes; a seeder orchestrates
 * factories (and raw writes) into a repeatable dataset.
 *
 *   const users = factory(User, (f) => ({
 *     name: f.name(),
 *     email: f.email(),
 *   }));
 *
 *   await users.create();                 // one persisted User
 *   await users.count(10).create();       // ten of them
 *   await users.make({ name: "Ada" });    // built, not persisted; with override
 *
 *   class DatabaseSeeder extends Seeder {
 *     async run() {
 *       await factory(User, ...).count(10).create();
 *     }
 *   }
 *   await seed(DatabaseSeeder);
 *
 * `Faker` is a tiny, dependency-free generator — enough for realistic-looking
 * fixtures without pulling in a faker library. It's seedable so runs can be
 * made deterministic.
 */

import type { Model } from "./model.js";
import type { Row } from "./database.js";

type ModelClass<T extends Model> = (new (attributes?: Row) => T) & {
  create(attributes: Row): Promise<T>;
};

/* --------------------------------- faker ---------------------------------- */

const FIRST_NAMES = [
  "Ada", "Grace", "Alan", "Linus", "Katherine", "Dennis", "Barbara", "Edsger",
  "Margaret", "Ken", "Radia", "Guido", "Anita", "Tim", "Joan", "Donald",
];
const LAST_NAMES = [
  "Lovelace", "Hopper", "Turing", "Torvalds", "Johnson", "Ritchie", "Liskov",
  "Dijkstra", "Hamilton", "Thompson", "Perlman", "Rossum", "Borg", "Berners-Lee",
];
const WORDS = [
  "keel", "hull", "helm", "anchor", "harbor", "tide", "sail", "bow", "stern",
  "deck", "mast", "rudder", "current", "voyage", "compass", "beacon", "port",
];
const DOMAINS = ["example.com", "test.dev", "mail.io", "keel.app"];

/** A small, seedable pseudo-random data source — no external dependency. */
export class Faker {
  private state: number;

  constructor(seed = 0x2545f491) {
    this.state = seed >>> 0 || 0x2545f491;
  }

  /** xorshift32 — deterministic given a seed, fast, and edge-safe. */
  private next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  /** An integer in [min, max]. */
  number(min = 0, max = 1000): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  boolean(): boolean {
    return this.next() < 0.5;
  }

  /** A random element of `items`. */
  pick<T>(items: readonly T[]): T {
    return items[this.number(0, items.length - 1)]!;
  }

  firstName(): string {
    return this.pick(FIRST_NAMES);
  }
  lastName(): string {
    return this.pick(LAST_NAMES);
  }
  name(): string {
    return `${this.firstName()} ${this.lastName()}`;
  }

  word(): string {
    return this.pick(WORDS);
  }
  words(count = 3): string {
    return Array.from({ length: count }, () => this.word()).join(" ");
  }
  sentence(count = 6): string {
    const s = this.words(count);
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
  }
  paragraph(sentences = 3): string {
    return Array.from({ length: sentences }, () => this.sentence()).join(" ");
  }

  /** A likely-unique, lowercased email. */
  email(): string {
    const handle = `${this.firstName()}.${this.lastName()}.${this.number(1, 9999)}`;
    return `${handle.toLowerCase().replace(/[^a-z0-9.]/g, "")}@${this.pick(DOMAINS)}`;
  }

  slug(): string {
    return `${this.word()}-${this.word()}-${this.number(1, 9999)}`;
  }

  /** An RFC-4122-shaped v4 UUID (from this generator, not crypto). */
  uuid(): string {
    const hex = () => this.number(0, 15).toString(16);
    const block = (n: number) => Array.from({ length: n }, hex).join("");
    return `${block(8)}-${block(4)}-4${block(3)}-${this.pick(["8", "9", "a", "b"])}${block(3)}-${block(12)}`;
  }
}

/* -------------------------------- factory --------------------------------- */

/** Called per instance; `index` lets definitions vary across a batch. */
export type Definition<T extends Model> = (faker: Faker, index: number) => Row;

export class Factory<T extends Model> {
  private _count = 1;

  constructor(
    private model: ModelClass<T>,
    private definition: Definition<T>,
    private faker: Faker = new Faker(),
  ) {}

  /** How many models the next `make`/`create` produces. */
  count(n: number): this {
    this._count = n;
    return this;
  }

  /** Use a specific Faker (e.g. a seeded one) for reproducible data. */
  usingFaker(faker: Faker): this {
    this.faker = faker;
    return this;
  }

  private attributesFor(index: number, overrides: Row): Row {
    return { ...this.definition(this.faker, index), ...overrides };
  }

  /** Build model instance(s) without persisting them. */
  make(overrides?: Row): T;
  make(overrides: Row, _internal: "many"): T[];
  make(overrides: Row = {}): T | T[] {
    const built = Array.from(
      { length: this._count },
      (_, i) => new this.model(this.attributesFor(i, overrides)),
    );
    return this._count === 1 ? built[0]! : built;
  }

  /** Persist model instance(s) via `Model.create`. */
  async create(overrides: Row = {}): Promise<T | T[]> {
    const created: T[] = [];
    for (let i = 0; i < this._count; i++) {
      created.push(await this.model.create(this.attributesFor(i, overrides)));
    }
    return this._count === 1 ? created[0]! : created;
  }
}

/** Start a factory for a model with an attribute definition. */
export function factory<T extends Model>(
  model: ModelClass<T>,
  definition: Definition<T>,
): Factory<T> {
  return new Factory<T>(model, definition);
}

/* -------------------------------- seeder ---------------------------------- */

export abstract class Seeder {
  /** Populate the database. Override this. */
  abstract run(): Promise<void>;

  /** Run other seeders in sequence — compose a `DatabaseSeeder` from parts. */
  protected async call(seeders: Array<new () => Seeder>): Promise<void> {
    for (const S of seeders) await new S().run();
  }
}

/** Instantiate and run a seeder class. */
export async function seed(SeederClass: new () => Seeder): Promise<void> {
  await new SeederClass().run();
}
