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
import type { Token, Factory } from "./container.js";
import { Config } from "./config.js";
import { View, type Renderable } from "./view.js";
import { Events, type Listener } from "./events.js";
import { Cache } from "./cache.js";
import { Logger } from "./logger.js";

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

/** Run a callback once the active application has booted (see `Application.onReady`). */
export function onReady(hook: (app: Application) => void | Promise<void>): void {
  app().onReady(hook);
}

/** Register a graceful-shutdown hook on the active application (see `Application.onShutdown`). */
export function onShutdown(hook: (app: Application) => void | Promise<void>): void {
  app().onShutdown(hook);
}

/** Gracefully terminate the active application, running its shutdown hooks. */
export function terminate(): Promise<void> {
  return app().terminate();
}

/**
 * Read configuration with dot notation: `config('app.name')`, or with a
 * fallback: `config('app.port', 3000)`.
 */
export function config<T = unknown>(key: string, fallback?: T): T {
  return app().make(Config).get<T>(key, fallback);
}

/* --------------------------- container helpers --------------------------- */
/* Bind and resolve against the active application from anywhere — no `this.app`. */

/** Register a transient binding — a fresh value every resolve. */
export function bind<T>(token: Token<T>, factory: Factory<T>): void {
  app().bind(token, factory);
}

/** Register a shared binding — resolved once, then cached. */
export function singleton<T>(token: Token<T>, factory: Factory<T>): void {
  app().singleton(token, factory);
}

/** Register an already-constructed value as a shared instance. */
export function instance<T>(token: Token<T>, value: T): T {
  return app().instance(token, value);
}

/** Resolve a token out of the container. */
export function make<T>(token: Token<T>): T {
  return app().make(token);
}

/** Whether a token is bound or has a cached instance. */
export function bound(token: Token): boolean {
  return app().bound(token);
}

/* ------------------------------- events -------------------------------- */

/** The application's event emitter. */
export function events(): Events {
  return app().make(Events);
}

/** Emit an event, awaiting every listener. */
export function emit<T = unknown>(event: string, payload?: T): Promise<void> {
  return events().emit(event, payload);
}

/** Subscribe to an event; returns an unsubscribe function. */
export function listen<T = unknown>(event: string, listener: Listener<T>): () => void {
  return events().on(event, listener);
}

/** The application's cache. */
export function cache(): Cache {
  return app().make(Cache);
}

/** The application's logger. */
export function logger(): Logger {
  return app().make(Logger);
}

/**
 * Render a view component through the View service, in one call:
 *
 *   return view(WelcomePage, { appName });   // component with props
 *   return view(HomePage);                    // component with no props
 *
 * Props are type-checked against the component. Returns a full HTML document
 * (Promise<string>) — return it straight from a route handler.
 */
export function view<P>(
  component: (props: P, ...rest: any[]) => Renderable,
  props: P,
): Promise<string>;
export function view(component: (...rest: any[]) => Renderable): Promise<string>;
export function view(
  component: (props?: any, ...rest: any[]) => Renderable,
  props?: any,
): Promise<string> {
  return app().make(View).render(component(props));
}
