# Factories & Seeders

Populate the database with realistic fixtures for tests and demos. A **factory**
describes how to build a model's attributes; a **seeder** orchestrates factories
(and raw writes) into a repeatable dataset. Both are edge-safe and dependency-free
— the built-in `Faker` needs no external library.

## Factories

Define a factory with the model and a definition function. The function receives
a `Faker` and the instance index, and returns the attributes:

```ts
import { factory } from "@shaferllc/keel/core";

const users = factory(User, (f, i) => ({
  name: f.name(),
  email: f.email(),
}));
```

Generate one with `keel make:factory User` (→ `database/factories/UserFactory.ts`).

### Building vs. persisting

```ts
users.make();                 // a User instance, not saved
users.make({ name: "Ada" });  // with an override
await users.create();         // saved via Model.create, id back-filled
await users.create({ role: "admin" });
```

### Batches

`count(n)` sets how many the next call produces (an array):

```ts
const ten = await users.count(10).create();       // User[]
const drafts = users.count(3).make();             // User[] (unsaved)

// the index lets each row differ
factory(User, (f, i) => ({ email: `user${i}@x.com` })).count(5);
```

## Faker

A small, seedable generator — enough for believable data without a dependency.

```ts
const f = new Faker();       // random
const f = new Faker(42);     // seeded — reproducible runs

f.name();        // "Grace Hopper"
f.firstName();   f.lastName();
f.email();       // "grace.hopper.1234@example.com"
f.word();        f.words(3);   f.sentence();   f.paragraph();
f.number(1, 100);   f.boolean();
f.pick(["a", "b", "c"]);
f.slug();        f.uuid();
```

Seed a factory's faker for deterministic fixtures:

```ts
import { Faker } from "@shaferllc/keel/core";
users.usingFaker(new Faker(42));
```

`Faker` uses an xorshift32 PRNG — fast, edge-safe, and seedable. (Its `uuid()` is
for fixtures, not security; use `crypto` for real identifiers.)

## Seeders

A seeder is a class with a `run()` method. Generate one with
`keel make:seeder Database`:

```ts
import { Seeder } from "@shaferllc/keel/core";

class UserSeeder extends Seeder {
  async run() {
    await factory(User, (f) => ({ name: f.name(), email: f.email() }))
      .count(10)
      .create();
  }
}

class DatabaseSeeder extends Seeder {
  async run() {
    await this.call([UserSeeder]); // compose seeders in order
  }
}
```

Run one with the `seed` helper (after your connection is registered):

```ts
import { seed } from "@shaferllc/keel/core";
import { setConnection } from "@shaferllc/keel/core";

setConnection(myConnection, "postgres");
await seed(DatabaseSeeder);
```

## In tests

Factories shine in tests — register a connection (or a mock), then build fixtures
inline:

```ts
setConnection(testConnection, "sqlite");

const [author] = await factory(User, (f) => ({ name: f.name() })).count(1).create();
const post = await factory(Post, (f) => ({ title: f.sentence() })).create({
  user_id: author.id,
});
```

## API reference

### `factory(model, definition)`

`factory<T extends Model>(model, definition: (f: Faker, i: number) => Row): ModelFactory<T>`

Start a factory for `model`. The definition receives a `Faker` and the instance
index, and returns the attributes.

### `ModelFactory`

Returned by `factory()` (the `Factory` class, exported as `ModelFactory`).

| Method | Signature | Notes |
|--------|-----------|-------|
| `make` | `(overrides?) => T \| T[]` | build instance(s), unsaved |
| `create` | `(overrides?) => Promise<T \| T[]>` | persist via `Model.create` |
| `count` | `(n) => this` | how many the next `make`/`create` yields |
| `usingFaker` | `(faker) => this` | use a seeded `Faker` for reproducible data |

`count(1)` still returns an array; `count()` unset returns a single model.

### `Faker`

`new Faker(seed?)` — seedable (deterministic) xorshift32 generator.

| Method | Returns |
|--------|---------|
| `name` / `firstName` / `lastName` | string |
| `email` / `slug` / `uuid` | string |
| `word` / `words(n?)` / `sentence(n?)` / `paragraph(n?)` | string |
| `number(min?, max?)` | number |
| `boolean` | boolean |
| `pick(items)` | one element of `items` |

`uuid()` is for fixtures, not security — use `crypto` for real ids.

### `Seeder` / `seed(SeederClass)`

Abstract `Seeder` with an `async run()`; `protected call([...Seeders])` composes
others in order. `seed(DatabaseSeeder)` instantiates and runs one.

### Interfaces & types

#### `Definition`

`type Definition<T> = (faker: Faker, index: number) => Row` — the factory
definition function.
