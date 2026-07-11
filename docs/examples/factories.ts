// Type-check harness for docs/factories.md. Compile-only — never executed.
import {
  factory,
  Faker,
  Seeder,
  seed,
  Model,
  setConnection,
  ModelFactory,
  type Definition,
  type Connection,
} from "@shaferllc/keel/core";

class User extends Model {
  static table = "users";
  declare id: number;
}
class Post extends Model {
  static table = "posts";
}

declare const myConnection: Connection;
declare const testConnection: Connection;

const users = factory(User, (f, i) => ({ name: f.name(), email: `u${i}@x.com` }));

export async function building() {
  users.make();
  users.make({ name: "Ada" });
  await users.create();
  await users.create({ role: "admin" });
  const ten = await users.count(10).create();
  const drafts = users.count(3).make();
  users.usingFaker(new Faker(42));
  return { ten, drafts };
}

export function faker() {
  const f = new Faker(42);
  return [
    f.name(),
    f.firstName(),
    f.lastName(),
    f.email(),
    f.word(),
    f.words(3),
    f.sentence(),
    f.paragraph(),
    f.number(1, 100),
    f.boolean(),
    f.pick(["a", "b", "c"]),
    f.slug(),
    f.uuid(),
  ];
}

class UserSeeder extends Seeder {
  async run() {
    await factory(User, (f) => ({ name: f.name() })).count(10).create();
  }
}
class DatabaseSeeder extends Seeder {
  async run() {
    await this.call([UserSeeder]);
  }
}

export async function seeding() {
  setConnection(myConnection, "postgres");
  await seed(DatabaseSeeder);
}

export async function inTests() {
  setConnection(testConnection, "sqlite");
  const created = await factory(User, (f) => ({ name: f.name() })).count(1).create();
  const author = (created as User[])[0]!;
  await factory(Post, (f) => ({ title: f.sentence() })).create({ user_id: author.id });
}

// type seams
const def: Definition<User> = (f, i) => ({ name: f.name(), i });
const own = factory(User, (f) => ({ name: f.name() }));
export type UserFactory = ModelFactory<User>;
export { def, own };
