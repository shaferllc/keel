/**
 * `TenantModel` — a model that belongs to a team, and can't be read or written
 * outside one.
 *
 *   class Post extends TenantModel {
 *     static table = "posts";
 *   }
 *
 *   await Post.all();                 // only the current team's posts
 *   await Post.create({ title: … });  // stamped with the current team
 *
 * Two halves, and both matter. The **read** side is a global scope, so every query
 * the model builds is constrained — you cannot forget it, because you never write
 * it. The **write** side is a `creating` hook that stamps the team id, so a row
 * can't be born ownerless and then be visible to everyone (or to no one).
 *
 * Outside a team context both halves throw. See context.ts for why that's the point.
 */

import { Model } from "../core/model.js";
import { addModelHook } from "../core/model-events.js";
import type { Row } from "../core/database.js";

import { currentTeamId } from "./context.js";

/** The name of the scope, so it can be escaped by name: `Post.withoutGlobalScope(TENANT_SCOPE)`. */
export const TENANT_SCOPE = "tenant";

export class TenantModel extends Model {
  /** The column holding the owning team. Override if your schema differs. */
  static teamColumn = "team_id";
}

// Registered on the base class, and inherited by every subclass — that inheritance
// is load-bearing. If it didn't hold, `Post.query()` would come back unconstrained
// and every tenant's rows would be readable, silently. (Both the scope and the hook
// walk the prototype chain; see model.ts / model-events.ts.)
TenantModel.addGlobalScope(TENANT_SCOPE, (query, model) => {
  // `model` is the concrete subclass being queried, so each one gets its own
  // teamColumn rather than the base class's.
  query.where((model as typeof TenantModel).teamColumn, currentTeamId());
});

addModelHook(TenantModel, "creating", (model) => {
  const column = (model.constructor as typeof TenantModel).teamColumn;
  const row = model as unknown as Row;

  // Don't overwrite an explicit team — a deliberate cross-team write (an admin tool,
  // a transfer) already said what it meant. Everything else gets the current team.
  if (row[column] === undefined || row[column] === null) {
    row[column] = currentTeamId();
  }
});
