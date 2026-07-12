import { TenantModel } from "@shaferllc/keel/teams";

/**
 * A project belongs to a team — and cannot be seen outside it.
 *
 * Extending `TenantModel` (not `Model`) is the entire difference. Reads are
 * constrained by an inherited global scope, so even `Project.find(id)` returns null
 * for another team's row; writes are stamped with the current team, so a project
 * can't be born ownerless. You never write `.where("team_id", …)`, which means you
 * can never forget it.
 */
export class Project extends TenantModel {
  static override table = "projects";
  static override fillable = ["name"];
  static override timestamps = true;

  declare id: number;
  declare name: string;
  declare team_id: number;
}
