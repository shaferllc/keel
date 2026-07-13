// Type-check harness for docs/starter-kits.md. Compile-only — never executed.
import { TenantModel } from "@shaferllc/keel/teams";

class Project extends TenantModel {
  static override table = "projects";
  declare id: number;
  declare name: string;
}

export async function tenantScoped() {
  await Project.all();
  await Project.create({ name: "Hi" });
  await Project.find(1); // null if another team's
}
