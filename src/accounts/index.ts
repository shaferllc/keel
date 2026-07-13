/**
 * Keel Accounts — public surface, imported from `@shaferllc/keel/accounts`.
 *
 *   import { AccountsServiceProvider, attempt } from "@shaferllc/keel/accounts";
 *
 * Password reset, email verification, and two-factor: the flows every app with a
 * login needs, built on the primitives already in core (`hash`, `encryption` with
 * purpose + expiry, `mail`, `rate-limit`). They live here, tested once, instead of
 * being copy-pasted into every starter kit — four copies of a security flow are
 * four copies that quietly rot.
 *
 * Views stay yours. These are functions and JSON endpoints; your controllers
 * render the forms.
 */

export { AccountsServiceProvider } from "./provider.js";

export {
  attempt,
  completeTwoFactor,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
} from "./flows.js";
export type { LoginResult } from "./flows.js";

export {
  confirmTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  hasTwoFactor,
  pendingTwoFactorSetup,
  recoveryCodesRemaining,
  redeemRecoveryCode,
  regenerateRecoveryCodes,
  verifyTwoFactorCode,
} from "./two-factor.js";
export type { TwoFactorOptions, TwoFactorSetup } from "./two-factor.js";

export {
  base32Decode,
  base32Encode,
  generateSecret,
  otpauthQrDataUrl,
  otpauthQrSvg,
  otpauthUri,
  totp,
  verifyTotp,
} from "./totp.js";
export type { OtpauthOptions, TotpOptions, VerifyOptions } from "./totp.js";

export {
  emailVerificationToken,
  passwordResetToken,
  twoFactorChallenge,
  verifyEmailToken,
  verifyPasswordResetToken,
  verifyTwoFactorChallenge,
  PURPOSE,
} from "./tokens.js";

export { accountStore, setAccountStore, tableStore } from "./store.js";
export type { AccountStore, AccountUser } from "./store.js";

export { registerAccountsRoutes } from "./routes.js";
export { accountsMigration } from "./migration.js";

export { defaultConfig, resolveConfig } from "./config.js";
export type { AccountsConfig } from "./config.js";
