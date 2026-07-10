/**
 * Global helpers — convenience functions for reaching the active application.
 *
 * These resolve against the "current" application, which is registered
 * automatically when an Application is constructed. In a normal single-app
 * process (Node server or one Worker isolate) that's exactly what you want:
 * call `config('app.name')` from anywhere without threading the container
 * through every function.
 */

import type { Application } from "./application.js";
import { Config } from "./config.js";

let current: Application | undefined;

/** Register the active application. Called by the Application constructor. */
export function setApplication(app: Application): void {
  current = app;
}

/** The active application container. Throws if none has been created. */
export function app(): Application {
  if (!current) {
    throw new Error(
      "No Keel application has been bootstrapped. Create an Application first.",
    );
  }
  return current;
}

/**
 * Read configuration with dot notation: `config('app.name')`, or with a
 * fallback: `config('app.port', 3000)`.
 */
export function config<T = unknown>(key: string, fallback?: T): T {
  return app().make(Config).get<T>(key, fallback);
}
