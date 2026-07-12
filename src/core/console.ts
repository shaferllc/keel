/**
 * The console — a real command system, not a wrapper round `process.argv`.
 *
 *   export const greet = defineCommand({
 *     name: "greet",
 *     description: "Greet someone",
 *     args: { name: arg.string({ description: "who to greet" }) },
 *     flags: { loud: flag.boolean({ alias: "l", description: "SHOUT IT" }) },
 *
 *     async run({ args, flags, ui }) {
 *       const message = `Hello, ${args.name}!`;
 *       ui.success(flags.loud ? message.toUpperCase() : message);
 *     },
 *   });
 *
 * `args.name` is a `string` and `flags.loud` is a `boolean` — **inferred from the
 * spec**, not cast. Declare an arg optional and its type becomes `string |
 * undefined`; give it a default and it's a `string` again. The types can't drift
 * from the parsing, because the parsing is generated from them.
 *
 * A command gets a `ui` (colors, tables, tasks, spinners) and a `prompt` (ask,
 * confirm, choice…), both of which switch to a captured, colorless "raw" mode
 * under test, so you can assert on what a command printed and script its answers.
 */

import type { Ui } from "./console-ui.js";
import type { Prompt } from "./console-prompt.js";

/* --------------------------------- specs ---------------------------------- */

export type ArgType = "string" | "number" | "spread";
export type FlagType = "string" | "number" | "boolean" | "array";

export interface ArgSpec<T = unknown> {
  readonly kind: "arg";
  readonly type: ArgType;
  readonly description?: string;
  readonly required: boolean;
  readonly default?: T;
  readonly parse?: (raw: string) => T;
  /** @internal — carries the value type. */
  readonly __value?: T;
}

export interface FlagSpec<T = unknown> {
  readonly kind: "flag";
  readonly type: FlagType;
  readonly description?: string;
  readonly required: boolean;
  readonly default?: T;
  /** A single-character shorthand: `-f`. */
  readonly alias?: string;
  readonly parse?: (raw: string) => T;
  /** @internal — carries the value type. */
  readonly __value?: T;
}

interface BaseOptions {
  description?: string;
}

interface ArgOptions<T> extends BaseOptions {
  /** Args are required by default. */
  required?: boolean;
  default?: T;
  parse?: (raw: string) => T;
}

interface FlagOptions<T> extends BaseOptions {
  /** Flags are optional by default. */
  required?: boolean;
  default?: T;
  alias?: string;
  parse?: (raw: string) => T;
}

/**
 * Whether a spec's value can be absent. Required, or defaulted, means present —
 * which is exactly what makes `args.name` a `string` rather than a
 * `string | undefined` you have to keep checking.
 */
type Present<O, Fallback extends boolean> = O extends { required: true }
  ? true
  : O extends { default: unknown }
    ? true
    : O extends { required: false }
      ? false
      : Fallback;

type ArgValue<O, T> = Present<O, true> extends true ? T : T | undefined;
type FlagValue<O, T> = Present<O, false> extends true ? T : T | undefined;

/** Positional arguments: `keel greet <name>`. */
export const arg = {
  string<const O extends ArgOptions<string> = Record<never, never>>(
    options?: O & ArgOptions<string>,
  ): ArgSpec<ArgValue<O, string>> {
    return { kind: "arg", type: "string", required: true, ...options } as ArgSpec<ArgValue<O, string>>;
  },

  number<const O extends ArgOptions<number> = Record<never, never>>(
    options?: O & ArgOptions<number>,
  ): ArgSpec<ArgValue<O, number>> {
    return { kind: "arg", type: "number", required: true, ...options } as ArgSpec<ArgValue<O, number>>;
  },

  /** Swallows every remaining value. Must be the last argument. */
  spread<const O extends ArgOptions<string[]> = Record<never, never>>(
    options?: O & ArgOptions<string[]>,
  ): ArgSpec<ArgValue<O, string[]>> {
    return { kind: "arg", type: "spread", required: true, ...options } as ArgSpec<ArgValue<O, string[]>>;
  },
};

/** Named options: `--force`, `-f`, `--name=Ada`. */
export const flag = {
  /** `--force` / `-f`, and `--no-force`. Defaults to `false`, so it's never undefined. */
  boolean<const O extends FlagOptions<boolean> = Record<never, never>>(
    options?: O & FlagOptions<boolean>,
  ): FlagSpec<boolean> {
    return { kind: "flag", type: "boolean", required: false, default: false, ...options } as FlagSpec<boolean>;
  },

  string<const O extends FlagOptions<string> = Record<never, never>>(
    options?: O & FlagOptions<string>,
  ): FlagSpec<FlagValue<O, string>> {
    return { kind: "flag", type: "string", required: false, ...options } as FlagSpec<FlagValue<O, string>>;
  },

  number<const O extends FlagOptions<number> = Record<never, never>>(
    options?: O & FlagOptions<number>,
  ): FlagSpec<FlagValue<O, number>> {
    return { kind: "flag", type: "number", required: false, ...options } as FlagSpec<FlagValue<O, number>>;
  },

  /** Repeatable: `--tag a --tag b` gives `["a", "b"]`. Defaults to `[]`. */
  array<const O extends FlagOptions<string[]> = Record<never, never>>(
    options?: O & FlagOptions<string[]>,
  ): FlagSpec<string[]> {
    return { kind: "flag", type: "array", required: false, default: [], ...options } as FlagSpec<string[]>;
  },
};

/* -------------------------------- commands -------------------------------- */

export type ArgsSpec = Record<string, ArgSpec<unknown>>;
export type FlagsSpec = Record<string, FlagSpec<unknown>>;

/** The values a spec produces — this is where `args.name: string` comes from. */
export type Values<S extends Record<string, { __value?: unknown }>> = {
  [K in keyof S]: S[K] extends { __value?: infer V } ? V : never;
};

/** What a command's `run` receives. */
export interface CommandContext<A extends ArgsSpec, F extends FlagsSpec> {
  args: Values<A>;
  flags: Values<F>;
  /** Everything after `--`, plus any unrecognized flags. */
  rest: string[];
  ui: Ui;
  prompt: Prompt;
  /** The kernel running this command — for `keel help`, or calling a sibling. */
  kernel: ConsoleKernel;
}

export interface CommandDefinition<
  A extends ArgsSpec = ArgsSpec,
  F extends FlagsSpec = FlagsSpec,
> {
  /** What the user types. `:` namespaces it — `make:controller`. */
  name: string;
  description?: string;
  /** Extra lines shown under `keel help <name>`. */
  help?: string[];
  /** Other names this command answers to. */
  aliases?: string[];
  args?: A;
  flags?: F;
  /** Don't fail on flags you didn't declare — they land in `rest`. */
  allowUnknownFlags?: boolean;
  /** Return a number to set the exit code. Throwing sets it to 1. */
  run(context: CommandContext<A, F>): void | number | Promise<void | number>;
}

/** Any command, whatever its arg/flag types — what the kernel stores. */
export type AnyCommand = CommandDefinition<ArgsSpec, FlagsSpec>;

/**
 * Define a command. The `args` and `flags` you declare become the types of
 * `args` and `flags` inside `run` — the whole point of the exercise.
 */
export function defineCommand<A extends ArgsSpec = Record<never, never>, F extends FlagsSpec = Record<never, never>>(
  definition: CommandDefinition<A, F>,
): CommandDefinition<A, F> {
  return definition;
}

/** Thrown when the argv doesn't fit the command's spec. */
export class ConsoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleError";
  }
}

/* --------------------------------- parsing -------------------------------- */

function coerce(spec: ArgSpec<unknown> | FlagSpec<unknown>, raw: string, label: string): unknown {
  if (spec.parse) return spec.parse(raw);

  if (spec.type === "number") {
    const value = Number(raw);
    if (Number.isNaN(value)) throw new ConsoleError(`${label} expects a number, got "${raw}".`);
    return value;
  }
  return raw;
}

export interface Parsed {
  args: Record<string, unknown>;
  flags: Record<string, unknown>;
  rest: string[];
}

/**
 * Turn argv into a command's args and flags.
 *
 * Handles `--flag value`, `--flag=value`, `--no-flag`, `-f value`, bundled short
 * flags (`-abc`), repeatable array flags, a `--` terminator, and a trailing
 * spread argument.
 */
export function parseArgv(argv: string[], definition: AnyCommand): Parsed {
  const argSpecs = Object.entries(definition.args ?? {});
  const flagSpecs = Object.entries(definition.flags ?? {});

  const byAlias = new Map<string, string>();
  for (const [name, spec] of flagSpecs) if (spec.alias) byAlias.set(spec.alias, name);

  const flags: Record<string, unknown> = {};
  const positional: string[] = [];
  const rest: string[] = [];

  const specFor = (token: string): [string, FlagSpec<unknown>] | undefined => {
    const name = byAlias.get(token) ?? token;
    const spec = definition.flags?.[name];
    return spec ? [name, spec] : undefined;
  };

  const setFlag = (name: string, spec: FlagSpec<unknown>, raw: string): void => {
    const label = `--${name}`;
    if (spec.type === "array") {
      const list = (flags[name] as string[] | undefined) ?? [];
      list.push(String(coerce(spec, raw, label)));
      flags[name] = list;
    } else {
      flags[name] = coerce(spec, raw, label);
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    // Everything after `--` is verbatim.
    if (token === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      const name = eq === -1 ? body : body.slice(0, eq);
      const inline = eq === -1 ? undefined : body.slice(eq + 1);

      // `--no-force` turns a boolean off.
      if (name.startsWith("no-")) {
        const found = specFor(name.slice(3));
        if (found && found[1].type === "boolean") {
          flags[found[0]] = false;
          continue;
        }
      }

      const found = specFor(name);
      if (!found) {
        if (definition.allowUnknownFlags) {
          rest.push(token);
          continue;
        }
        throw new ConsoleError(`Unknown flag "--${name}".`);
      }

      const [key, spec] = found;
      if (spec.type === "boolean") {
        flags[key] = inline === undefined ? true : inline !== "false";
        continue;
      }

      const value = inline ?? argv[++i];
      if (value === undefined) throw new ConsoleError(`Flag "--${key}" expects a value.`);
      setFlag(key, spec, value);
      continue;
    }

    // `-f`, or bundled `-abc` where only the last may take a value.
    if (token.startsWith("-") && token.length > 1) {
      const letters = [...token.slice(1)];

      for (let j = 0; j < letters.length; j++) {
        const letter = letters[j]!;
        const found = specFor(letter);

        if (!found) {
          if (definition.allowUnknownFlags) {
            rest.push(`-${letter}`);
            continue;
          }
          throw new ConsoleError(`Unknown flag "-${letter}".`);
        }

        const [key, spec] = found;
        if (spec.type === "boolean") {
          flags[key] = true;
          continue;
        }

        // A value-taking flag must be last in the bundle.
        const value = j === letters.length - 1 ? argv[++i] : letters.slice(j + 1).join("");
        if (value === undefined) throw new ConsoleError(`Flag "-${letter}" expects a value.`);
        setFlag(key, spec, value);
        break;
      }
      continue;
    }

    positional.push(token);
  }

  // Positionals -> declared args.
  const args: Record<string, unknown> = {};
  let cursor = 0;

  for (const [name, spec] of argSpecs) {
    if (spec.type === "spread") {
      const values = positional.slice(cursor);
      cursor = positional.length;
      if (!values.length && spec.required && spec.default === undefined) {
        throw new ConsoleError(`Missing argument "${name}".`);
      }
      args[name] = values.length ? values : ((spec.default as string[] | undefined) ?? []);
      continue;
    }

    const raw = positional[cursor++];
    if (raw === undefined) {
      if (spec.default !== undefined) {
        args[name] = spec.default;
        continue;
      }
      if (spec.required) throw new ConsoleError(`Missing argument "${name}".`);
      args[name] = undefined;
      continue;
    }

    args[name] = coerce(spec, raw, `Argument "${name}"`);
  }

  // Leftover positionals nobody claimed.
  rest.push(...positional.slice(cursor));

  // Defaults, then required checks.
  for (const [name, spec] of flagSpecs) {
    if (flags[name] === undefined && spec.default !== undefined) flags[name] = spec.default;
    if (flags[name] === undefined && spec.required) {
      throw new ConsoleError(`Missing required flag "--${name}".`);
    }
  }

  return { args, flags, rest };
}

/* --------------------------------- kernel --------------------------------- */

export interface ConsoleKernelOptions {
  /** The binary's name, shown in help. Default: `"keel"`. */
  binary?: string;
  ui?: Ui;
  prompt?: Prompt;
}

/** Registers commands, parses argv, and runs the right one. */
export class ConsoleKernel {
  private commands = new Map<string, AnyCommand>();
  private aliases = new Map<string, string>();

  constructor(private options: ConsoleKernelOptions = {}) {}

  get binary(): string {
    return this.options.binary ?? "keel";
  }

  /** Register one or more commands. */
  register(...commands: AnyCommand[]): this {
    for (const command of commands) {
      this.commands.set(command.name, command);
      for (const alias of command.aliases ?? []) this.aliases.set(alias, command.name);
    }
    return this;
  }

  /** Every registered command, sorted by name. */
  list(): AnyCommand[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  find(name: string): AnyCommand | undefined {
    return this.commands.get(name) ?? this.commands.get(this.aliases.get(name) ?? "");
  }

  private async ui(): Promise<Ui> {
    if (this.options.ui) return this.options.ui;
    const { createUi } = await import("./console-ui.js");
    return createUi();
  }

  private async prompt(): Promise<Prompt> {
    if (this.options.prompt) return this.options.prompt;
    const { createPrompt } = await import("./console-prompt.js");
    return createPrompt();
  }

  /**
   * Run a command from argv (without the node/script prefix). Returns the exit
   * code: 0 for success, 1 for a failure — never throws, because a console is a
   * bad place to surface a stack trace to a user who mistyped a flag.
   */
  async run(argv: string[]): Promise<number> {
    const ui = await this.ui();

    const [name, ...rest] = argv;

    // No command, or an explicit ask for help: list what's available.
    if (!name || name === "help" || name === "--help" || name === "-h") {
      const target = name === "help" ? rest[0] : undefined;
      if (target) {
        const command = this.find(target);
        if (!command) {
          ui.error(`Unknown command "${target}".`);
          return 1;
        }
        ui.write(this.commandHelp(command));
        return 0;
      }
      ui.write(this.help());
      return 0;
    }

    const command = this.find(name);
    if (!command) {
      ui.error(`Unknown command "${name}". Run "${this.binary} help" to see what's available.`);
      return 1;
    }

    // `--help` on a command shows its own help rather than running it.
    if (rest.includes("--help") || rest.includes("-h")) {
      ui.write(this.commandHelp(command));
      return 0;
    }

    try {
      const parsed = parseArgv(rest, command);
      const prompt = await this.prompt();

      const code = await command.run({
        args: parsed.args,
        flags: parsed.flags,
        rest: parsed.rest,
        ui,
        prompt,
        kernel: this,
      } as never);

      return typeof code === "number" ? code : 0;
    } catch (error) {
      // A usage error is the user's mistake — say what's wrong and how to fix it,
      // don't dump a stack at them.
      if (error instanceof ConsoleError) {
        ui.error(error.message);
        ui.write("");
        ui.write(this.commandHelp(command));
        return 1;
      }

      ui.error(error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack && process.env.KEEL_DEBUG) {
        ui.write(error.stack);
      }
      return 1;
    }
  }

  /** The `keel help` screen: every command, grouped by namespace. */
  help(): string {
    const lines: string[] = [`Usage: ${this.binary} <command> [options]`, ""];

    const groups = new Map<string, AnyCommand[]>();
    for (const command of this.list()) {
      const namespace = command.name.includes(":") ? command.name.split(":")[0]! : "";
      const group = groups.get(namespace) ?? [];
      group.push(command);
      groups.set(namespace, group);
    }

    // Ungrouped commands first, then each namespace.
    const order = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
    const width = Math.max(...this.list().map((c) => c.name.length), 0);

    for (const namespace of order) {
      lines.push(namespace ? `${namespace}:` : "Commands:");
      for (const command of groups.get(namespace)!) {
        lines.push(`  ${command.name.padEnd(width + 2)}${command.description ?? ""}`);
      }
      lines.push("");
    }

    lines.push(`Run "${this.binary} help <command>" for more on one of them.`);
    return lines.join("\n");
  }

  /** The help screen for a single command: its usage, args, and flags. */
  commandHelp(command: AnyCommand): string {
    const args = Object.entries(command.args ?? {});
    const flags = Object.entries(command.flags ?? {});

    const usage = [`${this.binary} ${command.name}`];
    for (const [name, spec] of args) {
      const label = spec.type === "spread" ? `...${name}` : name;
      usage.push(spec.required && spec.default === undefined ? `<${label}>` : `[${label}]`);
    }
    if (flags.length) usage.push("[options]");

    const lines: string[] = [];
    if (command.description) lines.push(command.description, "");
    lines.push(`Usage: ${usage.join(" ")}`, "");

    if (args.length) {
      lines.push("Arguments:");
      const width = Math.max(...args.map(([n]) => n.length));
      for (const [name, spec] of args) {
        const meta: string[] = [];
        if (!spec.required || spec.default !== undefined) meta.push("optional");
        if (spec.default !== undefined) meta.push(`default: ${JSON.stringify(spec.default)}`);
        const suffix = meta.length ? ` (${meta.join(", ")})` : "";
        lines.push(`  ${name.padEnd(width + 2)}${spec.description ?? ""}${suffix}`);
      }
      lines.push("");
    }

    if (flags.length) {
      lines.push("Options:");
      const labels = flags.map(([name, spec]) => (spec.alias ? `-${spec.alias}, --${name}` : `    --${name}`));
      const width = Math.max(...labels.map((l) => l.length));

      flags.forEach(([, spec], i) => {
        const meta: string[] = [];
        if (spec.required) meta.push("required");
        if (spec.default !== undefined && spec.type !== "boolean" && spec.type !== "array") {
          meta.push(`default: ${JSON.stringify(spec.default)}`);
        }
        const suffix = meta.length ? ` (${meta.join(", ")})` : "";
        lines.push(`  ${labels[i]!.padEnd(width + 2)}${spec.description ?? ""}${suffix}`);
      });
      lines.push("");
    }

    if (command.aliases?.length) lines.push(`Aliases: ${command.aliases.join(", ")}`, "");
    if (command.help?.length) lines.push(...command.help, "");

    return lines.join("\n").replace(/\n+$/, "");
  }
}
