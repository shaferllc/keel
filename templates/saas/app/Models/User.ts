import { Model } from "@shaferllc/keel/core";

export class User extends Model {
  static override table = "users";
  static override fillable = ["name", "email", "password", "github_id", "google_id", "avatar_url"];
  // Never serialize these — `hidden` is a denylist on toJSON().
  static override hidden = ["password", "two_factor_secret", "two_factor_recovery_codes"];
  static override timestamps = true;

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare email_verified_at: string | null;

  // Social login. Null for anyone who signed up with a password.
  declare github_id: string | null;
  declare google_id: string | null;
  declare avatar_url: string | null;

  // Added by the teams package. The team this user is acting in — re-checked against a
  // membership row on every request, never trusted as-is.
  declare current_team_id: number | null;
}
