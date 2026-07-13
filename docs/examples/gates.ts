// Type-check harness for docs/gates.md. Compile-only — never executed.
import { Application, json } from "@shaferllc/keel/core";
import {
  GatesServiceProvider,
  InviteCode,
  EmailAllowlist,
  canRegister,
  redeemInvite,
} from "@shaferllc/keel/gates";

export function install() {
  const app = new Application();
  app.register(GatesServiceProvider);
  return app;
}

export async function register(email: string, inviteCode?: string) {
  const gate = await canRegister(email, inviteCode);
  if (!gate.ok) return json({ error: gate.reason }, 403);

  if (gate.via === "code" && gate.invite) {
    await redeemInvite(gate.invite);
  }
  return json({ ok: true, via: gate.via });
}

export async function seed() {
  await InviteCode.create({ code: "ALPHA-42", max_uses: 10, uses: 0, expires_at: null });
  await EmailAllowlist.create({ email: "ada@example.com" });
}
