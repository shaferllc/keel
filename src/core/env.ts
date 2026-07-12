/**
 * Validate the environment **at boot**, not at 3am.
 *
 *   // config/env.ts
 *   export const env = defineEnv({
 *     APP_KEY: envVar.string({ required: true }),
 *     PORT: envVar.number({ default: 3000 }),
 *     NODE_ENV: envVar.enum(["development", "test", "production"], { default: "development" }),
 *     DATABASE_URL: envVar.url({ required: true }),
 *     DEBUG: envVar.boolean({ default: false }),
 *   });
 *
 *   env.PORT;      // number — not "3000", and not string | undefined
 *   env.NODE_ENV;  // "development" | "test" | "production"
 *
 * The plain `env("KEY")` helper hands back whatever is (or isn't) in
 * `process.env` — so a missing `DATABASE_URL` boots a perfectly healthy-looking
 * app that dies on the first request that needs it, in production, at night. This
 * checks the whole environment up front and **refuses to start** otherwise.
 *
 * It reports **every** problem at once, not the first one. Fixing a deploy one
 * missing variable per restart is its own small hell.
 */

/* --------------------------------- rules ---------------------------------- */

export type EnvType = "string" | "number" | "boolean" | "enum" | "url";

export interface EnvRule<T = unknown> {
  readonly type: EnvType;
  readonly required: boolean;
  readonly default?: T;
  readonly description?: string;
  /** For `enum`. */
  readonly values?: readonly string[];
  /** Reject a value with a reason. */
  readonly validate?: (value: T) => true | string;
  /** @internal — carries the value type. */
  readonly __value?: T;
}

interface RuleOptions<T> {
  required?: boolean;
  default?: T;
  description?: string;
  validate?: (value: T) => true | string;
}

/** Present unless it's explicitly optional with no default. */
type Present<O> = O extends { required: true }
  ? true
  : O extends { default: unknown }
    ? true
    : O extends { required: false }
      ? false
      : false;

type Value<O, T> = Present<O> extends true ? T : T | undefined;

/** The rules a variable can be held to. */
export const envVar = {
  string<O extends RuleOptions<string> = Record<never, never>>(
    options?: O & RuleOptions<string>,
  ): EnvRule<Value<O, string>> {
    return { type: "string", required: false, ...options } as EnvRule<Value<O, string>>;
  },

  number<O extends RuleOptions<number> = Record<never, never>>(
    options?: O & RuleOptions<number>,
  ): EnvRule<Value<O, number>> {
    return { type: "number", required: false, ...options } as EnvRule<Value<O, number>>;
  },

  /** `true`/`false`/`1`/`0`/`yes`/`no`. */
  boolean<O extends RuleOptions<boolean> = Record<never, never>>(
    options?: O & RuleOptions<boolean>,
  ): EnvRule<Value<O, boolean>> {
    return { type: "boolean", required: false, ...options } as EnvRule<Value<O, boolean>>;
  },

  /** One of a fixed set — the value is typed as the union, not `string`. */
  enum<const V extends readonly string[], O extends RuleOptions<V[number]> = Record<never, never>>(
    values: V,
    options?: O & RuleOptions<V[number]>,
  ): EnvRule<Value<O, V[number]>> {
    return { type: "enum", required: false, values, ...options } as EnvRule<Value<O, V[number]>>;
  },

  /** A string that must parse as a URL — catches a truncated connection string. */
  url<O extends RuleOptions<string> = Record<never, never>>(
    options?: O & RuleOptions<string>,
  ): EnvRule<Value<O, string>> {
    return { type: "url", required: false, ...options } as EnvRule<Value<O, string>>;
  },
};

/**
 * The shape a schema must have.
 *
 * `any` rather than `unknown` on purpose: `EnvRule<T>` has `validate(value: T)`,
 * which puts `T` in a *parameter* position and so makes the type invariant — an
 * `EnvRule<string>` isn't assignable to an `EnvRule<unknown>`. This is the
 * standard escape hatch for a schema constraint; the *values* stay fully typed,
 * which is what actually matters (see `EnvValues`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EnvSchema = Record<string, EnvRule<any>>;

/** The values a schema produces — where `env.PORT: number` comes from. */
export type EnvValues<S extends EnvSchema> = {
  readonly [K in keyof S]: S[K] extends { __value?: infer V } ? V : never;
};

/* ------------------------------- validation ------------------------------- */

/** Thrown when the environment doesn't satisfy the schema. Lists every problem. */
export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `The environment is not valid:\n\n${problems.map((p) => `  • ${p}`).join("\n")}\n\n` +
        `Set these in your .env (or your host's environment) and start again.`,
    );
    this.name = "EnvValidationError";
  }
}

const TRUE = new Set(["true", "1", "yes", "on"]);
const FALSE = new Set(["false", "0", "no", "off"]);

/** Coerce one raw string. Returns a problem string instead of throwing. */
function coerce(name: string, rule: EnvRule<unknown>, raw: string): { value: unknown } | { problem: string } {
  switch (rule.type) {
    case "number": {
      const value = Number(raw);
      if (raw.trim() === "" || Number.isNaN(value)) {
        return { problem: `${name} must be a number, got "${raw}".` };
      }
      return { value };
    }

    case "boolean": {
      const lower = raw.toLowerCase();
      if (TRUE.has(lower)) return { value: true };
      if (FALSE.has(lower)) return { value: false };
      return { problem: `${name} must be true or false, got "${raw}".` };
    }

    case "enum": {
      if (!rule.values?.includes(raw)) {
        return { problem: `${name} must be one of ${rule.values?.join(", ")}, got "${raw}".` };
      }
      return { value: raw };
    }

    case "url": {
      try {
        new URL(raw);
      } catch {
        return { problem: `${name} must be a valid URL, got "${raw}".` };
      }
      return { value: raw };
    }

    default:
      return { value: raw };
  }
}

export interface DefineEnvOptions {
  /** Where to read from. Default: `process.env`. */
  source?: Record<string, string | undefined>;
}

/**
 * Validate the environment against a schema and return the typed, frozen values.
 * Throws `EnvValidationError` listing **every** problem if it doesn't hold.
 *
 * Call it at module scope in `config/env.ts` so an invalid environment fails the
 * boot — loudly, immediately, and with the whole list.
 */
export function defineEnv<const S extends EnvSchema>(
  schema: S,
  options: DefineEnvOptions = {},
): EnvValues<S> {
  const source = options.source ?? (process.env as Record<string, string | undefined>);

  const values: Record<string, unknown> = {};
  const problems: string[] = [];

  for (const [name, rule] of Object.entries(schema)) {
    const raw = source[name];

    // Absent, or set to the empty string — which is almost always a mistake
    // rather than a deliberate "".
    if (raw === undefined || raw === "") {
      if (rule.default !== undefined) {
        values[name] = rule.default;
        continue;
      }
      if (rule.required) {
        const hint = rule.description ? ` (${rule.description})` : "";
        problems.push(`${name} is required but not set${hint}.`);
        continue;
      }
      values[name] = undefined;
      continue;
    }

    const result = coerce(name, rule, raw);
    if ("problem" in result) {
      problems.push(result.problem);
      continue;
    }

    const problem = rule.validate?.(result.value);
    if (problem !== undefined && problem !== true) {
      problems.push(`${name}: ${problem}`);
      continue;
    }

    values[name] = result.value;
  }

  // Every problem at once — fixing a deploy one missing variable per restart is
  // its own small hell.
  if (problems.length) throw new EnvValidationError(problems);

  return Object.freeze(values) as EnvValues<S>;
}
