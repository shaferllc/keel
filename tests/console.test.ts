import { test } from "node:test";
import assert from "node:assert/strict";

import {
  arg,
  flag,
  defineCommand,
  parseArgv,
  ConsoleKernel,
  ConsoleError,
} from "../src/core/console.js";
import { createUi, stripAnsi } from "../src/core/console-ui.js";
import { createPrompt } from "../src/core/console-prompt.js";

/** A kernel wired to captured UI/prompt, the way a test always wants it. */
function kernel(prompt = createPrompt({ trap: true })) {
  const ui = createUi({ raw: true });
  return { kernel: new ConsoleKernel({ ui, prompt, binary: "keel" }), ui, prompt };
}

/* --------------------------------- parsing -------------------------------- */

const greet = defineCommand({
  name: "greet",
  description: "Greet someone",
  args: {
    name: arg.string({ description: "who to greet" }),
    titles: arg.spread({ required: false }),
  },
  flags: {
    loud: flag.boolean({ alias: "l" }),
    times: flag.number({ alias: "t", default: 1 }),
    from: flag.string(),
    tag: flag.array(),
  },
  run() {},
});

test("positional args are assigned in order", () => {
  const { args } = parseArgv(["Ada", "Dr", "Prof"], greet);
  assert.equal(args.name, "Ada");
  assert.deepEqual(args.titles, ["Dr", "Prof"]);
});

test("a missing required arg is a usage error, not a crash", () => {
  assert.throws(() => parseArgv([], greet), ConsoleError);
  assert.throws(() => parseArgv([], greet), /Missing argument "name"/);
});

test("flags: long, short, inline, and negated", () => {
  assert.equal(parseArgv(["Ada", "--loud"], greet).flags.loud, true);
  assert.equal(parseArgv(["Ada", "-l"], greet).flags.loud, true);
  assert.equal(parseArgv(["Ada"], greet).flags.loud, false, "boolean flags default to false");
  assert.equal(parseArgv(["Ada", "--no-loud"], greet).flags.loud, false);

  assert.equal(parseArgv(["Ada", "--from", "Grace"], greet).flags.from, "Grace");
  assert.equal(parseArgv(["Ada", "--from=Grace"], greet).flags.from, "Grace");
  assert.equal(parseArgv(["Ada"], greet).flags.from, undefined);
});

test("number flags are coerced, and rejected when they aren't numbers", () => {
  assert.equal(parseArgv(["Ada", "--times", "3"], greet).flags.times, 3);
  assert.equal(parseArgv(["Ada"], greet).flags.times, 1, "the default applies");
  assert.throws(() => parseArgv(["Ada", "--times", "lots"], greet), /expects a number/);
});

test("array flags collect every occurrence", () => {
  assert.deepEqual(parseArgv(["Ada", "--tag", "a", "--tag", "b"], greet).flags.tag, ["a", "b"]);
  assert.deepEqual(parseArgv(["Ada"], greet).flags.tag, [], "array flags default to empty");
});

test("bundled short flags", () => {
  const { flags } = parseArgv(["Ada", "-lt", "5"], greet);
  assert.equal(flags.loud, true);
  assert.equal(flags.times, 5, "the last flag in the bundle takes the value");
});

test("everything after -- is left alone", () => {
  const { args, rest } = parseArgv(["Ada", "--", "--loud", "raw"], greet);
  assert.equal(args.name, "Ada");
  assert.deepEqual(rest, ["--loud", "raw"]);
});

test("an unknown flag is an error — unless the command allows them", () => {
  assert.throws(() => parseArgv(["Ada", "--nope"], greet), /Unknown flag "--nope"/);

  const loose = defineCommand({ ...greet, allowUnknownFlags: true });
  const { rest } = parseArgv(["Ada", "--nope"], loose);
  assert.deepEqual(rest, ["--nope"]);
});

test("a flag that needs a value and doesn't get one", () => {
  assert.throws(() => parseArgv(["Ada", "--from"], greet), /Flag "--from" expects a value/);
});

test("required flags and parse()", () => {
  const command = defineCommand({
    name: "x",
    flags: {
      env: flag.string({ required: true }),
      upper: flag.string({ parse: (raw) => raw.toUpperCase() }),
    },
    run() {},
  });

  assert.throws(() => parseArgv([], command), /Missing required flag "--env"/);
  assert.equal(parseArgv(["--env", "prod", "--upper", "abc"], command).flags.upper, "ABC");
});

test("optional args and defaults", () => {
  const command = defineCommand({
    name: "x",
    args: {
      first: arg.string(),
      second: arg.string({ required: false }),
      third: arg.string({ default: "fallback" }),
    },
    run() {},
  });

  const { args } = parseArgv(["a"], command);
  assert.equal(args.first, "a");
  assert.equal(args.second, undefined);
  assert.equal(args.third, "fallback");
});

/* ------------------------------- inference -------------------------------- */

test("arg and flag types are inferred from the spec", () => {
  defineCommand({
    name: "typed",
    args: {
      required: arg.string(),
      optional: arg.string({ required: false }),
      defaulted: arg.string({ default: "x" }),
      count: arg.number(),
      rest: arg.spread(),
    },
    flags: {
      loud: flag.boolean(),
      name: flag.string(),
      needed: flag.string({ required: true }),
      times: flag.number({ default: 1 }),
      tags: flag.array(),
    },
    run({ args, flags }) {
      // These are compile-time assertions: if the inference regressed, the file
      // wouldn't typecheck. `.length` on an optional would be an error.
      const a: string = args.required;
      const b: string | undefined = args.optional;
      const c: string = args.defaulted;
      const d: number = args.count;
      const e: string[] = args.rest;

      const f: boolean = flags.loud;
      const g: string | undefined = flags.name;
      const h: string = flags.needed;
      const i: number = flags.times;
      const j: string[] = flags.tags;

      assert.ok([a, b, c, d, e, f, g, h, i, j] !== undefined);
    },
  });
});

/* --------------------------------- kernel --------------------------------- */

test("the kernel runs a command and returns its exit code", async () => {
  const { kernel: k, ui } = kernel();

  k.register(
    defineCommand({
      name: "greet",
      args: { name: arg.string() },
      flags: { loud: flag.boolean({ alias: "l" }) },
      run({ args, flags, ui }) {
        const message = `Hello, ${args.name}!`;
        ui.success(flags.loud ? message.toUpperCase() : message);
      },
    }),
  );

  assert.equal(await k.run(["greet", "Ada"]), 0);
  assert.match(ui.logs.join("\n"), /Hello, Ada!/);

  ui.clear();
  assert.equal(await k.run(["greet", "Ada", "-l"]), 0);
  assert.match(ui.logs.join("\n"), /HELLO, ADA!/);
});

test("a command's return value is the exit code; a throw is exit 1", async () => {
  const { kernel: k, ui } = kernel();

  k.register(
    defineCommand({ name: "ok", run: () => {} }),
    defineCommand({ name: "code", run: () => 3 }),
    defineCommand({
      name: "boom",
      run() {
        throw new Error("it broke");
      },
    }),
  );

  assert.equal(await k.run(["ok"]), 0);
  assert.equal(await k.run(["code"]), 3);
  assert.equal(await k.run(["boom"]), 1);
  assert.match(ui.errors.join("\n"), /it broke/);
});

test("a usage error explains itself and shows the help, rather than a stack", async () => {
  const { kernel: k, ui } = kernel();
  k.register(greet);

  const code = await k.run(["greet"]); // no name given

  assert.equal(code, 1);
  assert.match(ui.errors.join("\n"), /Missing argument "name"/);
  assert.match(ui.logs.join("\n"), /Usage: keel greet/, "the help follows the error");
});

test("an unknown command points at help", async () => {
  const { kernel: k, ui } = kernel();
  assert.equal(await k.run(["nope"]), 1);
  assert.match(ui.errors.join("\n"), /Unknown command "nope"/);
  assert.match(ui.errors.join("\n"), /keel help/);
});

test("aliases resolve to the same command", async () => {
  const { kernel: k, ui } = kernel();

  k.register(
    defineCommand({
      name: "migrate:run",
      aliases: ["migrate"],
      run({ ui }) {
        ui.success("migrated");
      },
    }),
  );

  await k.run(["migrate"]);
  assert.match(ui.logs.join("\n"), /migrated/);
  assert.ok(k.find("migrate"));
  assert.equal(k.find("migrate")!.name, "migrate:run");
});

/* ---------------------------------- help ---------------------------------- */

test("the help screen lists commands grouped by namespace", async () => {
  const { kernel: k, ui } = kernel();

  k.register(
    defineCommand({ name: "serve", description: "Start the server", run() {} }),
    defineCommand({ name: "make:controller", description: "Generate a controller", run() {} }),
    defineCommand({ name: "make:job", description: "Generate a job", run() {} }),
  );

  await k.run([]);
  const out = ui.logs.join("\n");

  assert.match(out, /Usage: keel <command>/);
  assert.match(out, /Commands:/);
  assert.match(out, /serve\s+Start the server/);
  assert.match(out, /make:/);
  assert.match(out, /make:controller\s+Generate a controller/);
});

test("--help on a command shows its usage instead of running it", async () => {
  const { kernel: k, ui } = kernel();

  let ran = false;
  k.register(defineCommand({ ...greet, run: () => void (ran = true) }));

  await k.run(["greet", "--help"]);

  assert.equal(ran, false, "the command must not run");
  const out = ui.logs.join("\n");
  assert.match(out, /Usage: keel greet <name> \[\.\.\.titles\] \[options\]/);
  assert.match(out, /who to greet/);
  assert.match(out, /-l, --loud/);
  assert.match(out, /--times.*default: 1/s);
});

/* ----------------------------------- ui ----------------------------------- */

test("raw mode captures output and drops the colors", () => {
  const ui = createUi({ raw: true });

  ui.info("info");
  ui.success("success");
  ui.warning("warning");
  ui.error("error");
  ui.write("plain");

  assert.deepEqual(ui.logs, ["› info", "✔ success", "⚠ warning", "plain"]);
  assert.deepEqual(ui.errors, ["✖ error"]);

  // No escape codes anywhere.
  assert.equal(ui.logs.join(""), stripAnsi(ui.logs.join("")));
});

test("colors are applied when enabled, and stripAnsi undoes them", () => {
  const ui = createUi({ colors: true });
  const painted = ui.colors("red", "danger");

  assert.notEqual(painted, "danger");
  assert.equal(stripAnsi(painted), "danger");
});

test("tables line their columns up", () => {
  const ui = createUi({ raw: true, colors: false });

  ui.table(["Name", "Rows"]).row(["users", "42"]).row(["organizations", "7"]).render();

  const lines = ui.logs[0]!.split("\n");
  assert.match(lines[0]!, /^Name\s+Rows$/);
  assert.match(lines[1]!, /^─+\s+─+$/);
  assert.match(lines[2]!, /^users\s+42$/);
  assert.match(lines[3]!, /^organizations\s+7$/);
});

test("action lines up its verbs", () => {
  const ui = createUi({ raw: true, colors: false });

  ui.action("create", "app/Models/User.ts");
  ui.action("skip", "app/Models/Post.ts", "skipped");

  assert.equal(ui.logs[0], "CREATE  app/Models/User.ts");
  assert.equal(ui.logs[1], "SKIP    app/Models/Post.ts");
});

test("sticker draws a box around the message", () => {
  const ui = createUi({ raw: true, colors: false });
  ui.sticker(["Server running on :3000"], "Ready");

  assert.match(ui.logs[0]!, /^┌─+┐$/);
  assert.ok(ui.logs.some((l) => l.includes("Server running on :3000")));
  assert.match(ui.logs[ui.logs.length - 1]!, /^└─+┘$/);
});

test("tasks run in order and stop at the first failure", async () => {
  const ui = createUi({ raw: true, colors: false });
  const ran: string[] = [];

  const ok = await ui
    .tasks()
    .add("first", () => void ran.push("first"))
    .add("second", (task) => {
      ran.push("second");
      task.update("halfway");
      return "done";
    })
    .run();

  assert.equal(ok, true);
  assert.deepEqual(ran, ["first", "second"]);
  assert.match(ui.logs.join("\n"), /✔ second — done/);

  ui.clear();
  ran.length = 0;

  const failed = await ui
    .tasks()
    .add("one", () => void ran.push("one"))
    .add("two", () => {
      throw new Error("nope");
    })
    .add("three", () => void ran.push("three"))
    .run();

  assert.equal(failed, false);
  // A cascade of red after the first failure tells you nothing new.
  assert.deepEqual(ran, ["one"], "the tasks after a failure are skipped");
  assert.match(ui.errors.join("\n"), /two — nope/);
});

/* -------------------------------- prompts --------------------------------- */

test("trapped prompts answer without touching the terminal", async () => {
  const prompt = createPrompt({ trap: true });

  prompt.trap("What is your name?").replyWith("Ada");
  prompt.trap("Delete everything?").reject();
  prompt.trap("Keep going?").accept();
  prompt.trap("Pick a driver").chooseOption(1);
  prompt.trap("Pick features").chooseOptions([0, 2]);

  assert.equal(await prompt.ask("What is your name?"), "Ada");
  assert.equal(await prompt.confirm("Delete everything?"), false);
  assert.equal(await prompt.confirm("Keep going?"), true);
  assert.equal(await prompt.choice("Pick a driver", ["sqlite", "postgres"]), "postgres");
  assert.deepEqual(await prompt.multiple("Pick features", ["a", "b", "c"]), ["a", "c"]);

  prompt.assertAllTrapsUsed();
});

test("an untrapped prompt throws instead of hanging forever", async () => {
  const prompt = createPrompt({ trap: true });

  // This is the failure mode that matters: without it, the test would block on
  // stdin that no test will ever provide, and the suite would just... stop.
  await assert.rejects(() => prompt.ask("Unscripted?"), /was not trapped/);
});

test("assertAllTrapsUsed catches a question that was never asked", () => {
  const prompt = createPrompt({ trap: true });
  prompt.trap("Never asked?").replyWith("x");

  assert.throws(() => prompt.assertAllTrapsUsed(), /trapped but never asked: "Never asked\?"/);
});

test("a trap can assert the prompt's validation", async () => {
  const prompt = createPrompt({ trap: true });

  prompt
    .trap("Email?")
    .assertFails("", "Email is required")
    .assertPasses("ada@example.com")
    .replyWith("ada@example.com");

  const validate = (value: string) => (value ? true : "Email is required");
  assert.equal(await prompt.ask("Email?", { validate }), "ada@example.com");
});

test("a trap's validation assertion fails when the validator disagrees", async () => {
  const prompt = createPrompt({ trap: true });
  prompt.trap("Email?").assertFails("", "Wrong message").replyWith("x");

  await assert.rejects(
    () => prompt.ask("Email?", { validate: (v) => (v ? true : "Email is required") }),
    /to reject "" with "Wrong message", got "Email is required"/,
  );
});

test("choice by an index that doesn't exist is an error", async () => {
  const prompt = createPrompt({ trap: true });
  prompt.trap("Pick").chooseOption(9);

  await assert.rejects(() => prompt.choice("Pick", ["a", "b"]), /no option at index 9/);
});

test("a command can prompt, and the whole thing is testable", async () => {
  const prompt = createPrompt({ trap: true });
  const { kernel: k, ui } = kernel(prompt);

  k.register(
    defineCommand({
      name: "setup",
      async run({ ui, prompt }) {
        const name = await prompt.ask("Project name?");
        const driver = await prompt.choice("Database?", ["sqlite", "postgres"]);
        if (!(await prompt.confirm("Write the config?"))) return 1;

        ui.success(`${name} on ${driver}`);
      },
    }),
  );

  prompt.trap("Project name?").replyWith("keel-app");
  prompt.trap("Database?").chooseOption(1);
  prompt.trap("Write the config?").accept();

  assert.equal(await k.run(["setup"]), 0);
  assert.match(ui.logs.join("\n"), /keel-app on postgres/);
  prompt.assertAllTrapsUsed();
});

test("a command that a prompt refuses returns its exit code", async () => {
  const prompt = createPrompt({ trap: true });
  const { kernel: k } = kernel(prompt);

  k.register(
    defineCommand({
      name: "danger",
      async run({ prompt }) {
        if (!(await prompt.confirm("Are you sure?"))) return 2;
        return 0;
      },
    }),
  );

  prompt.trap("Are you sure?").reject();
  assert.equal(await k.run(["danger"]), 2);
});
