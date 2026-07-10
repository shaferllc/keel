import type { Application } from "./application.js";

/** Teach Hono about the framework variables we stash on the context. */
declare module "hono" {
  interface ContextVariableMap {
    app: Application;
  }
}
