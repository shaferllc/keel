import { env } from "@shaferllc/keel/core";

/**
 * Third-party services. Social login reads its credentials here.
 *
 * A provider with no client id is treated as *not configured*: its button never
 * renders and its routes 403. That's the same bargain billing makes with Stripe —
 * a fresh clone runs with an empty .env rather than offering a "Sign in with GitHub"
 * link that dead-ends on GitHub's error page.
 *
 * `env` and not `config("app.url")`: config files are evaluated as they load, so one
 * cannot depend on another having loaded first.
 */
const url = env("APP_URL", "http://localhost:3000");

export default {
  github: {
    id: env("GITHUB_CLIENT_ID", ""),
    secret: env("GITHUB_CLIENT_SECRET", ""),
    redirect: `${url}/auth/github/callback`,
  },

  google: {
    id: env("GOOGLE_CLIENT_ID", ""),
    secret: env("GOOGLE_CLIENT_SECRET", ""),
    redirect: `${url}/auth/google/callback`,
  },
};
