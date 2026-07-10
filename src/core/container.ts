/**
 * The service container — the backbone of the framework.
 *
 * Everything (config, router, controllers, your own services) is resolved
 * through here. This is the Node analogue of Laravel's Illuminate\Container.
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

export class Container {
  private bindings = new Map<Token, Binding>();
  private instances = new Map<Token, unknown>();

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
