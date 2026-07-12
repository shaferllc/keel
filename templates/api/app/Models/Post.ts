import { Model } from "@shaferllc/keel/core";

export class Post extends Model {
  static override table = "posts";
  // An allowlist, so a request body can't set columns you didn't intend.
  static override fillable = ["title", "body"];
  static override timestamps = true;

  declare id: number;
  declare title: string;
  declare body: string;
}
