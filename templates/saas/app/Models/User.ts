import { Model } from "@shaferllc/keel/core";

export class User extends Model {
  static override table = "users";
  static override fillable = ["name", "email", "password"];
  // Never serialize these — `hidden` is a denylist on toJSON().
  static override hidden = ["password", "two_factor_secret", "two_factor_recovery_codes"];
  static override timestamps = true;

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare email_verified_at: string | null;
}
