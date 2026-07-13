// Type-check harness for docs/orm.md. Compile-only — never executed.
import { Model } from "@shaferllc/keel/core";

class Post extends Model {
  static override table = "posts";
  declare id: number;
  declare title: string;
  declare user_id: number;
}

export class User extends Model {
  static override table = "users";
  declare id: number;
  declare email: string;

  posts() {
    return this.hasMany(Post);
  }
}

export async function map() {
  const user = await User.find(1);
  if (!user) return;
  await user.posts();
  await User.with("posts").where("email", user.email).first();
  await User.create({ email: "ada@example.com" });
  user.email = "grace@example.com";
  await user.save();
  await user.delete();
}
