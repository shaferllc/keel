import type { Application } from "./application.js";
import type { Method } from "./http/router.js";

/** Teach Hono about the framework variables we stash on the context. */
declare module "hono" {
  interface ContextVariableMap {
    app: Application;
    route?: { name?: string; pattern: string; methods: Method[]; config: Record<string, unknown> };
    subdomains?: Record<string, string>;
    session?: Record<string, unknown>;
  }
}
