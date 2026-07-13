/**
 * Signup gates — invite codes + email allowlist for private alpha / waitlist.
 * Distinct from team invitations (`@shaferllc/keel/teams`).
 */

import { Model } from "../core/model.js";
import type { Migration } from "../core/migrations.js";

export class InviteCode extends Model {
  static override table = "invite_codes";
  static override fillable = ["code", "max_uses", "uses", "created_by", "expires_at"];
  static override timestamps = true;

  declare id: number;
  declare code: string;
  declare max_uses: number;
  declare uses: number;
  declare created_by: number | null;
  declare expires_at: string | null;
}

export class EmailAllowlist extends Model {
  static override table = "email_allowlist";
  static override fillable = ["email", "created_by"];
  static override timestamps = true;

  declare id: number;
  declare email: string;
  declare created_by: number | null;
}

export type GateCheck =
  | { ok: true; via: "allowlist" | "code"; invite?: InviteCode }
  | { ok: false; reason: string };

/** Private alpha: allowlisted email OR a valid invite code. */
export async function canRegister(email: string, inviteCode?: string): Promise<GateCheck> {
  const normalized = email.toLowerCase().trim();

  const allowed = await EmailAllowlist.newQuery().where("email", normalized).first();
  if (allowed) return { ok: true, via: "allowlist" };

  const code = String(inviteCode ?? "").trim();
  if (!code) {
    return { ok: false, reason: "Registration requires an invite code or allowlisted email." };
  }

  const invite = await InviteCode.newQuery().where("code", code).first();
  if (!invite) return { ok: false, reason: "That invite code is invalid." };

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "That invite code has expired." };
  }

  if (invite.uses >= invite.max_uses) {
    return { ok: false, reason: "That invite code has already been used up." };
  }

  return { ok: true, via: "code", invite };
}

export async function redeemInvite(invite: InviteCode): Promise<void> {
  await invite.update({ uses: invite.uses + 1 });
}

/**
 * Schema for invite codes + allowlist.
 * Uses IF NOT EXISTS so apps that already created these tables (e.g. early
 * keel-cloud) can still register the provider safely.
 */
export function gatesMigration(): Migration {
  return {
    name: "gates_00_invite_allowlist",
    async up(schema) {
      await schema.raw(`
        CREATE TABLE IF NOT EXISTS invite_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code VARCHAR(255) NOT NULL UNIQUE,
          max_uses INTEGER DEFAULT 1,
          uses INTEGER DEFAULT 0,
          created_by INTEGER,
          expires_at TIMESTAMP,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        )
      `);
      await schema.raw(`
        CREATE TABLE IF NOT EXISTS email_allowlist (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email VARCHAR(255) NOT NULL UNIQUE,
          created_by INTEGER,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        )
      `);
    },
    async down(schema) {
      await schema.dropTable("email_allowlist").catch(() => {});
      await schema.dropTable("invite_codes").catch(() => {});
    },
  };
}
