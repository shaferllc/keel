/**
 * The service container — the backbone of the framework.
 *
 * Everything (config, router, controllers, your own services) is resolved
 * through here — it is the single registry every service resolves out of.
 *
 * Bindings are keyed by a string/symbol token OR a class constructor. A
 * factory receives the container so it can resolve its own dependencies.
 */

export type Token<T = unknown> = string | symbol | Constructor<T>;
export type Constructor<T = unknown> = new (...args: any[]) => T;
export type Factory<T> = (app: Container) => T;

interface Binding<T = unknown> {
  factory: Factory<T>;
  shared: boolean;
}

interface SavedBinding {
  binding: Binding | undefined;
  instance: unknown;
  hadInstance: boolean;
}

export class Container {
  private bindings = new Map<Token, Binding>();
  private instances = new Map<Token, unknown>();
  private swaps = new Map<Token, SavedBinding>();

  /** Register a transient binding — a fresh value every resolve. */
  bind<T>(token: Token<T>, factory: Factory<T>): this {
    this.bindings.set(token, { factory, shared: false });
    return this;
  }

  /** Register a shared binding — resolved once, then cached. */
  singleton<T>(token: Token<T>, factory: Factory<T>): this {
    this.bindings.set(token, { factory, shared: true });
    return this;
  }

  /** Register an already-constructed value as a shared instance. */
  instance<T>(token: Token<T>, value: T): T {
    this.instances.set(token, value);
    return value;
  }

  /**
   * Register an alias that resolves to another token — `alias("router", Router)`
   * lets `make("router")` return whatever `make(Router)` does, honoring the
   * target's own sharing (the target owns the singleton; the alias just points).
   */
  alias<T>(alias: Token<T>, target: Token<T>): this {
    this.bindings.set(alias, { factory: (app) => app.make(target), shared: false });
    return this;
  }

  /**
   * Temporarily replace a binding with a fake — for tests. The replacement is
   * shared (resolved once), and the original binding/instance is remembered so
   * `restore()` can put it back. Idempotent per token: the first swap saves the
   * original; later swaps just change the fake.
   *
   *   app.swap(Mailer, () => fakeMailer);
   *   // … exercise code that resolves Mailer …
   *   app.restore(Mailer);
   */
  swap<T>(token: Token<T>, factory: Factory<T>): this {
    if (!this.swaps.has(token)) {
      this.swaps.set(token, {
        binding: this.bindings.get(token),
        instance: this.instances.get(token),
        hadInstance: this.instances.has(token),
      });
    }
    this.bindings.set(token, { factory, shared: true });
    this.instances.delete(token); // force the next make() through the fake
    return this;
  }

  /** Undo a `swap()` — restore the original binding. No token restores every swap. */
  restore(token?: Token): this {
    if (token === undefined) {
      for (const t of [...this.swaps.keys()]) this.restore(t);
      return this;
    }
    const saved = this.swaps.get(token);
    if (!saved) return this;
    this.swaps.delete(token);
    this.instances.delete(token);
    if (saved.binding) this.bindings.set(token, saved.binding);
    else this.bindings.delete(token);
    if (saved.hadInstance) this.instances.set(token, saved.instance);
    return this;
  }

  /** True if the token is bound or has a cached instance. */
  bound(token: Token): boolean {
    return this.bindings.has(token) || this.instances.has(token);
  }

  /** Resolve a token out of the container. */
  make<T>(token: Token<T>): T {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    const binding = this.bindings.get(token) as Binding<T> | undefined;

    if (!binding) {
      // Zero-arg classes can be auto-resolved without an explicit binding.
      if (typeof token === "function") {
        return this.build(token as Constructor<T>);
      }
      throw new Error(
        `Nothing bound in the container for [${String(token)}].`,
      );
    }

    const resolved = binding.factory(this);

    if (binding.shared) {
      this.instances.set(token, resolved);
    }

    return resolved;
  }

  /** Instantiate a class, giving its constructor the container. */
  build<T>(ctor: Constructor<T>): T {
    return new ctor(this);
  }

  /** Alias `app(token)` sugar over `make`. */
  get<T>(token: Token<T>): T {
    return this.make(token);
  }
}
