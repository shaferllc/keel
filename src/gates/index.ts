/**
 * Keel Gates — private-alpha / waitlist signup gating.
 *
 *   import { GatesServiceProvider, canRegister, redeemInvite } from "@shaferllc/keel/gates";
 *
 * Not the same as team invitations in `@shaferllc/keel/teams`.
 */

export { GatesServiceProvider } from "./provider.js";
export {
  InviteCode,
  EmailAllowlist,
  canRegister,
  redeemInvite,
  gatesMigration,
} from "./models.js";
export type { GateCheck } from "./models.js";
