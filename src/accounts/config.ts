/**
 * Accounts configuration. Defaults live here and are merged under
 * `config("accounts")` by the provider; an app overrides any of them in
 * `config/accounts.ts` (publish it with `keel vendor:publish --tag accounts-config`).
 */

import { config } from "../core/helpers.js";

export interface AccountsConfig {
  /** The users table. Parameterized so accounts doesn't dictate your schema. */
  userTable: string;

  /** Mount the JSON endpoints. Off if you'd rather call the functions yourself. */
  routes: { enabled: boolean; prefix: string };

  passwordReset: {
    expiresIn: string;
    /** Where the emailed link points. `:token` is replaced. */
    url: string;
  };

  verification: {
    expiresIn: string;
    url: string;
  };

  twoFactor: {
    issuer: string;
    /** Periods of clock drift to tolerate either side of now. */
    window: number;
    /** How long the post-password, pre-code window stays open. */
    challengeExpiresIn: string;
    recoveryCodes: number;
  };

  /**
   * Throttling for the credential endpoints. Six digits inside a 30-second window
   * is trivially brute-forced without this, and password reset is a free email
   * cannon pointed at whoever you name.
   */
  rateLimit: { max: number; window: number };

  mail: { from?: string };
}

export const defaultConfig: AccountsConfig = {
  userTable: "users",
  routes: { enabled: true, prefix: "auth" },
  passwordReset: {
    expiresIn: "60m",
    url: "/reset-password?token=:token",
  },
  verification: {
    expiresIn: "24h",
    url: "/verify-email?token=:token",
  },
  twoFactor: {
    issuer: "Keel",
    window: 1,
    challengeExpiresIn: "5m",
    recoveryCodes: 8,
  },
  rateLimit: { max: 5, window: 60 },
  mail: {},
};

/** Read the effective accounts config off the application, filling any gaps. */
export function resolveConfig(): AccountsConfig {
  const raw = config<Partial<AccountsConfig>>("accounts", {});

  return {
    userTable: raw.userTable ?? defaultConfig.userTable,
    routes: { ...defaultConfig.routes, ...raw.routes },
    passwordReset: { ...defaultConfig.passwordReset, ...raw.passwordReset },
    verification: { ...defaultConfig.verification, ...raw.verification },
    twoFactor: { ...defaultConfig.twoFactor, ...raw.twoFactor },
    rateLimit: { ...defaultConfig.rateLimit, ...raw.rateLimit },
    mail: { ...defaultConfig.mail, ...raw.mail },
  };
}
