import { Model } from "@keel/core";

/** The `notes` table — used by the /api/notes CRUD resource (Keel API demo). */
export class Note extends Model {
  static table = "notes";
  static fillable = ["body", "created_at"];

  declare id: number;
  declare body: string;
  declare created_at: number;
}
