/**
 * A tiny event emitter for decoupling. Listeners may be async; `emit` awaits
 * them in registration order. Bound as a singleton on the application, so the
 * global `emit()` / `listen()` helpers reach it from anywhere.
 *
 *   listen("user.registered", (user) => sendWelcome(user));
 *   await emit("user.registered", user);
 *
 * Declare an event in `EventsList` and the emitter checks both sides of it —
 * the payload you fire and the payload your listener receives:
 *
 *   declare module "@shaferllc/keel/core" {
 *     interface EventsList {
 *       "order.paid": { id: number; total: number };
 *     }
 *   }
 *
 * One listener's failure never stops another's: `emit` runs them all, then
 * reports what broke — to `onError()` if you registered one, otherwise by
 * rejecting.
 */

/**
 * The registry of known events, keyed by name. Empty by default — augment it
 * from your app to type an event's payload:
 *
 *   declare module "@shaferllc/keel/core" {
 *     interface EventsList {
 *       "user.registered": User;
 *     }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventsList {}

/** A declared event name, or any other string. */
export type EventName = keyof EventsList | (string & {});

/**
 * The declared payload for an event, or `unknown` for an undeclared one.
 *
 * The `[E]` tuple wrapper stops the conditional from distributing: `EventName`
 * is itself a union, and a naked `E` would resolve to a *union* of every
 * declared payload rather than the one event's.
 */
export type PayloadOf<E> = [E] extends [keyof EventsList] ? EventsList[E & keyof EventsList] : unknown;

/**
 * `emit`'s payload argument. Declared events must be fired with their payload;
 * undeclared (and void) ones may be fired without.
 */
export type EmitArgs<P> = [P] extends [void | undefined]
  ? [payload?: P]
  : unknown extends P
    ? [payload?: P]
    : [payload: P];

/**
 * The payload type for an event.
 *
 * A **declared** event takes its payload from `EventsList`, and `NoInfer` is
 * load-bearing there: without it TypeScript would infer the payload type from
 * the value you pass, so `emit("order.paid", anythingAtAll)` would type-check by
 * inferring it to whatever you handed over — and the registry would enforce
 * nothing.
 *
 * An **undeclared** event behaves as it always has: the payload type is inferred
 * from the listener, or given explicitly as `listen<Order>("order.paid", …)`,
 * and falls back to `unknown`.
 */
export type Resolve<T, E> = [E] extends [keyof EventsList]
  ? NoInfer<EventsList[E & keyof EventsList]>
  : T;

export type Listener<T = unknown> = (payload: T) => void | Promise<void>;

/** A listener for *every* event, as registered by `onAny`. */
export type AnyListener = (event: string, payload: unknown) => void | Promise<void>;

/** Called when a listener throws, instead of `emit` rejecting. */
export type ErrorHandler = (event: string, error: unknown, payload: unknown) => void | Promise<void>;

/** One recorded emission, as captured by a fake. */
export interface RecordedEvent {
  event: string;
  payload: unknown;
}

export class Events {
  private listeners = new Map<string, Set<Listener>>();
  private anyListeners = new Set<AnyListener>();
  private errorHandler?: ErrorHandler;

  /** Non-null while faking: the events to intercept (`true` = all of them). */
  private faked?: true | Set<string>;
  private buffer?: EventBuffer;

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<T = unknown, E extends EventName = EventName>(
    event: E,
    listener: Listener<Resolve<T, E>>,
  ): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener as Listener);
    this.listeners.set(event, set);
    return () => this.off(event, listener as Listener);
  }

  /** Subscribe for a single emission. */
  once<T = unknown, E extends EventName = EventName>(
    event: E,
    listener: Listener<Resolve<T, E>>,
  ): () => void {
    const wrapper: Listener = async (payload) => {
      // Unsubscribe before awaiting, so a listener that re-emits the same event
      // doesn't re-trigger this one.
      this.listeners.get(event)?.delete(wrapper);
      await (listener as Listener)(payload);
    };
    return this.on<T, E>(event, wrapper as Listener<Resolve<T, E>>);
  }

  off<T = unknown, E extends EventName = EventName>(
    event: E,
    listener: Listener<Resolve<T, E>>,
  ): void {
    this.listeners.get(event)?.delete(listener as Listener);
  }

  /**
   * Subscribe to *every* event — for logging and other cross-cutting concerns.
   * These run before the event's own listeners. Returns an unsubscribe function.
   */
  onAny(listener: AnyListener): () => void {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  /**
   * Handle listener failures instead of letting `emit` reject. Without one, an
   * `emit` whose listeners threw rejects (with an `AggregateError` if more than
   * one did) — errors are never silently swallowed.
   */
  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  /**
   * Emit an event, awaiting every listener in registration order.
   *
   * A listener that throws does not stop the others — they all run, and the
   * failures are reported afterwards. That's the point of an emitter: one
   * subscriber's bug shouldn't silently cancel an unrelated subscriber's work.
   */
  async emit<T = unknown, E extends EventName = EventName>(
    event: E,
    ...args: EmitArgs<Resolve<T, E>>
  ): Promise<void> {
    const payload = args[0];

    if (this.faked && (this.faked === true || this.faked.has(event))) {
      this.buffer?.record(event, payload);
      return;
    }

    const errors: unknown[] = [];

    // Snapshot both sets: a listener that (un)subscribes mid-emit affects only
    // the next emission, not this one.
    for (const listener of [...this.anyListeners]) {
      try {
        await listener(event, payload);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        await listener(payload);
      } catch (error) {
        errors.push(error);
      }
    }

    if (!errors.length) return;

    if (this.errorHandler) {
      for (const error of errors) await this.errorHandler(event, error, payload);
      return;
    }
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(errors, `${errors.length} listeners for "${event}" failed.`);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(event?: string): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }

  /** Drop every `onAny` listener and the error handler too. */
  clearAll(): void {
    this.listeners.clear();
    this.anyListeners.clear();
    this.errorHandler = undefined;
  }

  /**
   * Record emissions instead of running listeners, so a test can assert an event
   * fired without triggering its side effects. Undo with `restore()`.
   *
   *   const events = events().fake();
   *   await register(user);
   *   events.assertEmitted("user.registered");
   *
   * Pass one or more event names to fake only those — everything else dispatches
   * for real.
   */
  fake(only?: EventName | EventName[]): EventBuffer {
    this.faked = only === undefined ? true : new Set(Array.isArray(only) ? only : [only]);
    this.buffer = new EventBuffer();
    return this.buffer;
  }

  /** Stop faking; listeners run for real again. */
  restore(): void {
    this.faked = undefined;
    this.buffer = undefined;
  }
}

/* ------------------------------ event buffer ------------------------------ */

/** What a fake records, plus assertions over it. */
export class EventBuffer {
  private events: RecordedEvent[] = [];

  /** @internal — called by `Events.emit` while faking. */
  record(event: string, payload: unknown): void {
    this.events.push({ event, payload });
  }

  /** Every emission recorded so far, in order. */
  all(): RecordedEvent[] {
    return [...this.events];
  }

  /** The payloads recorded for one event. */
  payloadsFor<E extends EventName>(event: E): PayloadOf<E>[] {
    return this.events.filter((e) => e.event === event).map((e) => e.payload as PayloadOf<E>);
  }

  /**
   * Assert the event fired — optionally only counting emissions whose payload
   * satisfies `predicate`.
   *
   *   buffer.assertEmitted("order.paid", (o) => o.total === 4200);
   */
  assertEmitted<E extends EventName>(
    event: E,
    predicate?: (payload: PayloadOf<E>) => boolean,
  ): void {
    const matches = this.payloadsFor(event).filter((p) => predicate?.(p) ?? true);
    if (matches.length) return;

    const fired = this.listenerCountFor(event);
    throw new Error(
      predicate && fired
        ? `Expected "${event}" to be emitted with a matching payload. It fired ${fired} time(s), but none matched.`
        : `Expected "${event}" to be emitted, but it was not. ${this.summary()}`,
    );
  }

  assertNotEmitted<E extends EventName>(event: E): void {
    const fired = this.listenerCountFor(event);
    if (fired) throw new Error(`Expected "${event}" not to be emitted, but it fired ${fired} time(s).`);
  }

  assertEmittedCount<E extends EventName>(event: E, expected: number): void {
    const fired = this.listenerCountFor(event);
    if (fired !== expected) {
      throw new Error(`Expected "${event}" to be emitted ${expected} time(s), but it fired ${fired}.`);
    }
  }

  /** Assert nothing at all was emitted. */
  assertNoneEmitted(): void {
    if (this.events.length) {
      throw new Error(`Expected no events, but ${this.events.length} fired. ${this.summary()}`);
    }
  }

  private listenerCountFor(event: string): number {
    return this.events.filter((e) => e.event === event).length;
  }

  private summary(): string {
    if (!this.events.length) return "No events were emitted.";
    const names = [...new Set(this.events.map((e) => e.event))].join(", ");
    return `Emitted: ${names}.`;
  }
}
