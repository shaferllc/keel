/**
 * Interactive prompts for console commands — ask, confirm, choice, and friends.
 *
 *   const name = await prompt.ask("What is your name?");
 *   const ok = await prompt.confirm("Delete everything?");
 *   const driver = await prompt.choice("Pick a driver", ["sqlite", "postgres"]);
 *
 * `node:readline` is imported dynamically, so the core still loads on the edge.
 *
 * ## Prompts are testable, which is the whole point
 *
 * A command that asks questions is normally a command you can't test. So a prompt
 * can be **trapped**: you script the answer up front, and the prompt never
 * touches the terminal.
 *
 *   const prompt = createPrompt({ trap: true });
 *   prompt.trap("What is your name?").replyWith("Ada");
 *   prompt.trap("Delete everything?").reject();
 *
 * An untrapped prompt in trap mode **throws** rather than hanging forever waiting
 * on stdin that a test will never provide.
 */

/* --------------------------------- options -------------------------------- */

export interface PromptOptions<T> {
  /** Pressing enter accepts this. */
  default?: T;
  /** Shown in dim text beside the question. */
  hint?: string;
  /** Return true to accept, or a string explaining why not. */
  validate?: (value: T) => true | string;
  /** Transform the value before it's returned. */
  result?: (value: T) => T;
}

export interface ChoiceOptions<T> extends PromptOptions<T> {
  /** Show this many options at once. */
  limit?: number;
}

/** A choice: a bare string, or a value with a label. */
export type Choice = string | { value: string; label?: string; hint?: string };

const valueOf = (choice: Choice): string => (typeof choice === "string" ? choice : choice.value);
const labelOf = (choice: Choice): string =>
  typeof choice === "string" ? choice : (choice.label ?? choice.value);

/* --------------------------------- traps ---------------------------------- */

/** A scripted answer, waiting for the prompt that matches it. */
export interface Trap {
  /** Answer an `ask` / `secure` / `autocomplete`. */
  replyWith(value: string): Trap;
  /** Answer a `confirm` / `toggle` with yes. */
  accept(): Trap;
  /** Answer a `confirm` / `toggle` with no. */
  reject(): Trap;
  /** Answer a `choice` by index. */
  chooseOption(index: number): Trap;
  /** Answer a `multiple` by indexes. */
  chooseOptions(indexes: number[]): Trap;
  /** Assert the prompt's `validate` rejects this input, with this message. */
  assertFails(value: string, message?: string): Trap;
  /** Assert the prompt's `validate` accepts this input. */
  assertPasses(value: string): Trap;
}

interface TrapState {
  question: string;
  answer?: unknown;
  answered: boolean;
  expectFail: { value: string; message?: string }[];
  expectPass: string[];
}

/* --------------------------------- prompt --------------------------------- */

export interface Prompt {
  ask(question: string, options?: PromptOptions<string>): Promise<string>;
  /** Like `ask`, but the input isn't echoed. */
  secure(question: string, options?: PromptOptions<string>): Promise<string>;
  confirm(question: string, options?: PromptOptions<boolean>): Promise<boolean>;
  /** A confirm with your own labels. */
  toggle(question: string, labels: [string, string], options?: PromptOptions<boolean>): Promise<boolean>;
  choice(question: string, choices: Choice[], options?: ChoiceOptions<string>): Promise<string>;
  multiple(question: string, choices: Choice[], options?: ChoiceOptions<string[]>): Promise<string[]>;
  autocomplete(question: string, choices: Choice[], options?: ChoiceOptions<string>): Promise<string>;

  /** Script an answer for a question, so a test never blocks on stdin. */
  trap(question: string): Trap;
  /** Whether every trapped question was actually asked. */
  assertAllTrapsUsed(): void;
}

export interface PromptFactoryOptions {
  /** Answer from traps instead of the terminal. Tests set this. */
  trap?: boolean;
}

export function createPrompt(options: PromptFactoryOptions = {}): Prompt {
  const traps = new Map<string, TrapState>();
  const trapping = options.trap ?? false;

  /** Read one line from the terminal. */
  async function readLine(question: string, mask = false): Promise<string> {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // For a secure prompt, swallow the echo so the password isn't left on screen.
    if (mask) {
      const output = rl as unknown as { output: { write(chunk: string): void } };
      const original = output.output.write.bind(output.output);
      output.output.write = (chunk: string) => {
        if (chunk.includes(question)) original(chunk);
      };
    }

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        if (mask) process.stdout.write("\n");
        resolve(answer);
      });
    });
  }

  /**
   * Resolve a question from its trap, running whatever assertions were attached.
   * Returns `undefined` when there's no trap — the caller decides what that means.
   */
  function fromTrap<T>(question: string, validate?: (value: T) => true | string): T | undefined {
    const state = traps.get(question);
    if (!state) return undefined;

    for (const { value, message } of state.expectFail) {
      const result = validate ? validate(value as T) : true;
      if (result === true) {
        throw new Error(`Expected the prompt "${question}" to reject ${JSON.stringify(value)}, but it passed.`);
      }
      if (message !== undefined && result !== message) {
        throw new Error(
          `Expected the prompt "${question}" to reject ${JSON.stringify(value)} with "${message}", got "${result}".`,
        );
      }
    }

    for (const value of state.expectPass) {
      const result = validate ? validate(value as T) : true;
      if (result !== true) {
        throw new Error(
          `Expected the prompt "${question}" to accept ${JSON.stringify(value)}, but it said "${result}".`,
        );
      }
    }

    state.answered = true;
    return state.answer as T;
  }

  /** Nothing scripted this question, and there's no terminal to ask. */
  function untrapped(question: string): never {
    throw new Error(
      `The prompt "${question}" was not trapped. Script it with prompt.trap(${JSON.stringify(question)}).replyWith(…) — ` +
        `otherwise the command would block forever waiting for input a test can't give it.`,
    );
  }

  function check<T>(question: string, value: T, options?: PromptOptions<T>): T {
    const problem = options?.validate?.(value);
    if (problem !== undefined && problem !== true) throw new Error(`${question}: ${problem}`);
    return options?.result ? options.result(value) : value;
  }

  const prompt: Prompt = {
    async ask(question, options) {
      if (trapping) {
        const answer = fromTrap<string>(question, options?.validate);
        if (answer === undefined) untrapped(question);
        return check(question, answer, options);
      }

      const hint = options?.default ? ` (${options.default})` : "";
      const raw = (await readLine(`${question}${hint} `)).trim();
      const value = raw || options?.default || "";

      const problem = options?.validate?.(value);
      // Ask again rather than dying — a typo shouldn't cost them the whole command.
      if (problem !== undefined && problem !== true) {
        console.error(problem);
        return prompt.ask(question, options);
      }

      return options?.result ? options.result(value) : value;
    },

    async secure(question, options) {
      if (trapping) {
        const answer = fromTrap<string>(question, options?.validate);
        if (answer === undefined) untrapped(question);
        return check(question, answer, options);
      }
      const value = (await readLine(`${question} `, true)).trim();
      return check(question, value, options);
    },

    async confirm(question, options) {
      return prompt.toggle(question, ["y", "n"], options);
    },

    async toggle(question, labels, options) {
      if (trapping) {
        const answer = fromTrap<boolean>(question, options?.validate);
        if (answer === undefined) untrapped(question);
        return check(question, answer, options);
      }

      const fallback = options?.default ?? false;
      const hint = fallback ? `[${labels[0].toUpperCase()}/${labels[1]}]` : `[${labels[0]}/${labels[1].toUpperCase()}]`;

      const raw = (await readLine(`${question} ${hint} `)).trim().toLowerCase();
      const value = raw === "" ? fallback : raw === labels[0].toLowerCase() || raw === "yes" || raw === "true";

      return check(question, value, options);
    },

    async choice(question, choices, options) {
      if (trapping) {
        const index = fromTrap<number>(question);
        if (index === undefined) untrapped(question);
        const choice = choices[index];
        if (!choice) throw new Error(`The prompt "${question}" has no option at index ${index}.`);
        return check(question, valueOf(choice), options);
      }

      console.log(question);
      choices.forEach((choice, i) => console.log(`  ${i + 1}) ${labelOf(choice)}`));

      const raw = (await readLine("> ")).trim();
      const index = Number(raw) - 1;
      const choice = choices[index];

      if (!choice) {
        console.error(`Pick a number between 1 and ${choices.length}.`);
        return prompt.choice(question, choices, options);
      }

      return check(question, valueOf(choice), options);
    },

    async multiple(question, choices, options) {
      if (trapping) {
        const indexes = fromTrap<number[]>(question);
        if (indexes === undefined) untrapped(question);
        const values = indexes.map((i) => {
          const choice = choices[i];
          if (!choice) throw new Error(`The prompt "${question}" has no option at index ${i}.`);
          return valueOf(choice);
        });
        return check(question, values, options);
      }

      console.log(`${question} (comma-separated numbers)`);
      choices.forEach((choice, i) => console.log(`  ${i + 1}) ${labelOf(choice)}`));

      const raw = (await readLine("> ")).trim();
      const values = raw
        .split(",")
        .map((part) => choices[Number(part.trim()) - 1])
        .filter((choice): choice is Choice => choice !== undefined)
        .map(valueOf);

      return check(question, values, options);
    },

    async autocomplete(question, choices, options) {
      if (trapping) {
        const answer = fromTrap<string>(question);
        if (answer === undefined) untrapped(question);
        return check(question, answer, options);
      }

      // Without a raw-mode TTY there's no live filtering to do, so it degrades to
      // a plain choice list rather than pretending.
      return prompt.choice(question, choices, options);
    },

    trap(question) {
      const state: TrapState = {
        question,
        answered: false,
        expectFail: [],
        expectPass: [],
      };
      traps.set(question, state);

      const api: Trap = {
        replyWith(value) {
          state.answer = value;
          return api;
        },
        accept() {
          state.answer = true;
          return api;
        },
        reject() {
          state.answer = false;
          return api;
        },
        chooseOption(index) {
          state.answer = index;
          return api;
        },
        chooseOptions(indexes) {
          state.answer = indexes;
          return api;
        },
        assertFails(value, message) {
          state.expectFail.push({ value, message });
          return api;
        },
        assertPasses(value) {
          state.expectPass.push(value);
          return api;
        },
      };

      return api;
    },

    assertAllTrapsUsed() {
      const unused = [...traps.values()].filter((t) => !t.answered).map((t) => t.question);
      if (unused.length) {
        throw new Error(`These prompts were trapped but never asked: ${unused.map((q) => `"${q}"`).join(", ")}.`);
      }
    },
  };

  return prompt;
}
