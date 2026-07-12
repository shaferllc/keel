/**
 * Model lifecycle events. A model fires these as it is retrieved, saved, and
 * deleted, so an app can hook behaviour onto a model without editing every call
 * site — slug a title on `creating`, bust a cache on `saved`, cascade on
 * `deleting`. The `*ing` events are cancelable: a hook returning `false` aborts
 * the operation (the write never runs).
 *
 *   User.creating((user) => { user.uuid = crypto.randomUUID(); });
 *   User.deleting((user) => user.isAdmin ? false : undefined); // veto
 *   User.observe(new UserObserver());
 *
 * Hooks are keyed by the exact model class (subclasses don't inherit a parent's
 * hooks), stored off the class in a WeakMap so they never leak into instances or
 * `save()`'s column spread.
 */

import type { Model } from "./model.js";

export type ModelEvent =
  | "retrieved"
  | "creating"
  | "created"
  | "updating"
  | "updated"
  | "saving"
  | "saved"
  | "deleting"
  | "deleted"
  | "restoring"
  | "restored";

/** A lifecycle hook. Returning `false` from a cancelable event aborts the op. */
export type ModelHook<T extends Model = Model> = (model: T) => void | boolean | Promise<void | boolean>;

/** An observer: an object whose methods are named after the events they handle. */
export type ModelObserver<T extends Model = Model> = Partial<Record<ModelEvent, ModelHook<T>>>;

/** Events whose hooks can veto the operation by returning `false`. */
const CANCELABLE = new Set<ModelEvent>(["creating", "updating", "saving", "deleting", "restoring"]);

/** The full event list, for wiring up an observer. */
export const MODEL_EVENTS: ModelEvent[] = [
  "retrieved",
  "creating",
  "created",
  "updating",
  "updated",
  "saving",
  "saved",
  "deleting",
  "deleted",
  "restoring",
  "restored",
];

// Class object → event → hooks. A WeakMap so unloaded classes are collectable.
const registry = new WeakMap<object, Map<ModelEvent, ModelHook[]>>();

/** Register a hook for `event` on a model class. */
export function addModelHook(cls: object, event: ModelEvent, hook: ModelHook): void {
  let byEvent = registry.get(cls);
  if (!byEvent) registry.set(cls, (byEvent = new Map()));
  const hooks = byEvent.get(event) ?? [];
  hooks.push(hook);
  byEvent.set(event, hooks);
}

/** Attach every matching method of an observer object as a hook. */
export function addModelObserver(cls: object, observer: ModelObserver): void {
  for (const event of MODEL_EVENTS) {
    const hook = observer[event];
    if (typeof hook === "function") addModelHook(cls, event, hook as ModelHook);
  }
}

/** Drop a class's hooks (or all of them) — a test helper for a clean slate. */
export function clearModelHooks(cls?: object): void {
  if (cls) registry.delete(cls);
}

/**
 * Fire an event's hooks in registration order. Returns `false` only when a
 * cancelable event had a hook return `false` — the caller then skips the write.
 */
export async function fireModelEvent(cls: object, event: ModelEvent, model: Model): Promise<boolean> {
  const hooks = registry.get(cls)?.get(event);
  if (!hooks?.length) return true;
  const cancelable = CANCELABLE.has(event);
  for (const hook of hooks) {
    const result = await hook(model);
    if (cancelable && result === false) return false;
  }
  return true;
}
