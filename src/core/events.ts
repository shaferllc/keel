/**
 * A tiny event emitter for decoupling. Listeners may be async; `emit` awaits
 * them in registration order. Bound as a singleton on the application, so the
 * global `emit()` / `listen()` helpers reach it from anywhere.
 *
 *   listen("user.registered", (user) => sendWelcome(user));
 *   await emit("user.registered", user);
 */

export type Listener<T = unknown> = (payload: T) => void | Promise<void>;

export class Events {
  private listeners = new Map<string, Set<Listener>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<T = unknown>(event: string, listener: Listener<T>): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener as Listener);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  /** Subscribe for a single emission. */
  once<T = unknown>(event: string, listener: Listener<T>): () => void {
    const wrapper: Listener<T> = async (payload) => {
      this.off(event, wrapper);
      await listener(payload);
    };
    return this.on(event, wrapper);
  }

  off<T = unknown>(event: string, listener: Listener<T>): void {
    this.listeners.get(event)?.delete(listener as Listener);
  }

  /** Emit an event, awaiting every listener in order. */
  async emit<T = unknown>(event: string, payload?: T): Promise<void> {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) await listener(payload);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(event?: string): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}
