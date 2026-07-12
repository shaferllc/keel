import type { Application } from "./application.js";
import type { Method } from "./http/router.js";

/** Teach Hono about the framework variables we stash on the context. */
declare module "hono" {
  interface ContextVariableMap {
    app: Application;
    route?: { name?: string; pattern: string; methods: Method[]; config: Record<string, unknown> };
    subdomains?: Record<string, string>;
    session?: Record<string, unknown>;
    /** The token-authenticated user id, set by `bearerAuth()`/`tokenAuth()`/`basicAuth()`. */
    auth_id?: string;
    /** The verified opaque access token, set by `tokenAuth()`. */
    access_token?: import("./tokens.js").AccessToken;
    /** The request's locale, set by `detectLocale()`. */
    locale?: string;
    /** The team the request is acting as, set by `teamContext()`. */
    team_id?: string | number;
    /** Route-model-bound params, resolved before the handler by `bindModel()`. */
    bindings?: Record<string, unknown>;
  }
}
