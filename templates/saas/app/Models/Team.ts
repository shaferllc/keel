import { Model } from "@shaferllc/keel/core";
import { Billable } from "@shaferllc/keel/billing";

/**
 * Billable team — the customer for subscriptions. Membership APIs still use
 * `@shaferllc/keel/teams`'s Team model; this class reads the same `teams` table
 * and adds billing columns via `billableTable: "teams"`.
 *
 * Owner email is kept off the model attributes (WeakMap) so `save()` never tries
 * to write a non-existent `owner_email` column.
 */
const ownerEmails = new WeakMap<object, string>();

export class Team extends Billable(Model) {
  static override table = "teams";
  static override fillable = ["name", "slug", "owner_id"];
  static override timestamps = true;

  declare id: number;
  declare name: string;
  declare slug: string;
  declare owner_id: number;

  withOwnerEmail(email: string): this {
    ownerEmails.set(this, email);
    return this;
  }

  billingName(): string | undefined {
    return this.name;
  }

  billingEmail(): string | undefined {
    return ownerEmails.get(this);
  }
}
