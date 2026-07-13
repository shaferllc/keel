import { env } from "@shaferllc/keel/core";

/**
 * Accounts — password reset, email verification, two-factor.
 * HTML controllers own the auth UI; JSON /auth/* routes stay off.
 */
export default {
  userTable: "users",
  routes: { enabled: false, prefix: "auth" },

  passwordReset: {
    expiresIn: "60m",
    url: "/reset-password?token=:token",
  },

  verification: {
    expiresIn: "24h",
    url: "/verify-email?token=:token",
  },

  twoFactor: {
    issuer: env("APP_NAME", "Keel"),
    window: 1,
    challengeExpiresIn: "5m",
    recoveryCodes: 8,
  },

  rateLimit: { max: 5, window: 60 },

  mail: {
    from: env("MAIL_FROM", "noreply@localhost"),
  },
};
