/**
 * Terminal UI for console commands — colors, a logger, tables, boxes, and a task
 * runner. No dependency: ANSI codes are a dozen escape sequences, not a package.
 *
 *   ui.success("Migrated 3 tables");
 *   ui.table(["Name", "Rows"]).row(["users", "42"]).render();
 *
 * Everything goes through the same `write`, which is what makes the whole thing
 * testable: `createUi({ raw: true })` strips the colors and buffers the output
 * instead of printing it, so a test can assert on exactly what a command said.
 */

/* -------------------------------- colors ---------------------------------- */

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  bgRed: 41,
  bgGreen: 42,
  bgYellow: 43,
} as const;

export type ColorName = keyof typeof CODES;

/** Paint text, or don't — the same call site works either way. */
export interface Colors {
  (name: ColorName, text: string): string;
  readonly enabled: boolean;
}

function makeColors(enabled: boolean): Colors {
  const fn = ((name: ColorName, text: string) =>
    enabled ? `\u001b[${CODES[name]}m${text}\u001b[0m` : text) as {
    (name: ColorName, text: string): string;
    enabled: boolean;
  };
  fn.enabled = enabled;
  return fn as Colors;
}

/** Strip ANSI escapes — used by the raw mode, and handy in assertions. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[\d+m/g, "");
}

/* --------------------------------- tables --------------------------------- */

export interface Table {
  head(...columns: string[]): Table;
  row(cells: string[]): Table;
  rows(rows: string[][]): Table;
  /** Render it and write it out. */
  render(): void;
  /** Render it to a string instead of writing it. */
  toString(): string;
}

/* ---------------------------------- tasks --------------------------------- */

/** What a single task can report while it runs. */
export interface TaskHandle {
  update(message: string): void;
}

export interface Tasks {
  add(title: string, run: (task: TaskHandle) => Promise<string | void> | string | void): Tasks;
  /** Run them in order. Resolves to false if any task failed. */
  run(): Promise<boolean>;
}

/* ----------------------------------- ui ----------------------------------- */

export interface UiOptions {
  /**
   * Buffer output instead of printing it, and drop the colors. What tests use —
   * `ui.logs` then holds every line.
   */
  raw?: boolean;
  /** Force colors on or off. Defaults to on unless raw, or NO_COLOR is set. */
  colors?: boolean;
}

export interface Ui {
  readonly colors: Colors;
  /** In raw mode, every line written. Empty otherwise. */
  readonly logs: string[];
  /** In raw mode, every line written to stderr. */
  readonly errors: string[];

  /** Write a line verbatim. */
  write(line: string): void;

  debug(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  /** Goes to stderr. */
  error(message: string): void;
  /** Goes to stderr. */
  fatal(message: string): void;

  /**
   * A one-line status for something you did: `CREATE  app/Models/User.ts`.
   * The verb is padded so a run of them lines up.
   */
  action(verb: string, target: string, status?: "done" | "skipped" | "failed"): void;

  table(head?: string[]): Table;

  /** A boxed message — for the thing you want them to actually read. */
  sticker(lines: string[], title?: string): void;

  /** Numbered next-steps. */
  instructions(lines: string[], title?: string): void;

  tasks(): Tasks;

  /** Clear the captured buffers (raw mode). */
  clear(): void;
}

const SYMBOLS = {
  info: "›",
  success: "✔",
  warning: "⚠",
  error: "✖",
  debug: "·",
};

export function createUi(options: UiOptions = {}): Ui {
  const raw = options.raw ?? false;
  const useColors = options.colors ?? (!raw && !process.env.NO_COLOR);
  const colors = makeColors(useColors);

  const logs: string[] = [];
  const errors: string[] = [];

  const write = (line: string): void => {
    if (raw) logs.push(stripAnsi(line));
    else console.log(line);
  };

  const writeError = (line: string): void => {
    if (raw) errors.push(stripAnsi(line));
    else console.error(line);
  };

  const label = (symbol: string, color: ColorName, message: string): string =>
    `${colors(color, symbol)} ${message}`;

  const ui: Ui = {
    colors,
    logs,
    errors,

    write,

    debug: (message) => write(label(SYMBOLS.debug, "gray", colors("gray", message))),
    info: (message) => write(label(SYMBOLS.info, "blue", message)),
    success: (message) => write(label(SYMBOLS.success, "green", message)),
    warning: (message) => write(label(SYMBOLS.warning, "yellow", message)),
    error: (message) => writeError(label(SYMBOLS.error, "red", message)),
    fatal: (message) => writeError(label(SYMBOLS.error, "red", colors("bold", message))),

    action(verb, target, status = "done") {
      const color: ColorName = status === "failed" ? "red" : status === "skipped" ? "yellow" : "green";
      const line = `${colors(color, verb.toUpperCase().padEnd(8))}${target}`;
      if (status === "failed") writeError(line);
      else write(line);
    },

    table(head) {
      const headers = head ? [...head] : [];
      const body: string[][] = [];

      const table: Table = {
        head(...columns) {
          headers.length = 0;
          headers.push(...columns);
          return table;
        },
        row(cells) {
          body.push(cells);
          return table;
        },
        rows(list) {
          body.push(...list);
          return table;
        },
        toString() {
          const all = headers.length ? [headers, ...body] : body;
          if (!all.length) return "";

          const columns = Math.max(...all.map((r) => r.length));
          const widths = Array.from({ length: columns }, (_, i) =>
            Math.max(...all.map((row) => stripAnsi(row[i] ?? "").length)),
          );

          const line = (cells: string[]): string =>
            cells
              .map((cell, i) => cell + " ".repeat(Math.max(0, widths[i]! - stripAnsi(cell).length)))
              .join("  ")
              .trimEnd();

          const out: string[] = [];
          if (headers.length) {
            out.push(line(headers.map((h) => colors("bold", h))));
            out.push(widths.map((w) => "─".repeat(w)).join("  "));
          }
          for (const row of body) out.push(line(row));
          return out.join("\n");
        },
        render() {
          const text = table.toString();
          if (text) write(text);
        },
      };

      return table;
    },

    sticker(lines, title) {
      const content = title ? [colors("bold", title), "", ...lines] : [...lines];
      const width = Math.max(...content.map((l) => stripAnsi(l).length));

      write(`┌─${"─".repeat(width)}─┐`);
      for (const line of content) {
        const pad = " ".repeat(width - stripAnsi(line).length);
        write(`│ ${line}${pad} │`);
      }
      write(`└─${"─".repeat(width)}─┘`);
    },

    instructions(lines, title) {
      if (title) write(colors("bold", title));
      lines.forEach((line, i) => write(`  ${colors("gray", `${i + 1}.`)} ${line}`));
    },

    tasks() {
      const queue: { title: string; run: (task: TaskHandle) => Promise<string | void> | string | void }[] = [];

      const runner: Tasks = {
        add(title, run) {
          queue.push({ title, run });
          return runner;
        },
        async run() {
          let ok = true;

          for (const { title, run } of queue) {
            let note = "";
            const handle: TaskHandle = {
              update: (message) => {
                note = message;
              },
            };

            const started = Date.now();
            try {
              const result = await run(handle);
              const detail = result || note;
              const ms = Date.now() - started;
              ui.write(
                `${colors("green", SYMBOLS.success)} ${title}${detail ? ` ${colors("gray", `— ${detail}`)}` : ""} ${colors("gray", `(${ms}ms)`)}`,
              );
            } catch (error) {
              ok = false;
              // Stop at the first failure: the tasks after it almost certainly
              // depend on it, and a cascade of red tells you nothing new.
              ui.error(`${title} — ${error instanceof Error ? error.message : String(error)}`);
              break;
            }
          }

          return ok;
        },
      };

      return runner;
    },

    clear() {
      logs.length = 0;
      errors.length = 0;
    },
  };

  return ui;
}
