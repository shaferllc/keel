// Type-check harness for docs/console.md. Compile-only — never executed.
import {
  defineCommand,
  arg,
  flag,
  ConsoleKernel,
  createUi,
  createPrompt,
  startRepl,
  stripAnsi,
  type Application,
  type Ui,
  type Prompt,
  type CommandDefinition,
  type ReplHelper,
} from "@shaferllc/keel/core";

export const greet = defineCommand({
  name: "greet",
  description: "Greet someone",

  args: { name: arg.string({ description: "who to greet" }) },
  flags: { loud: flag.boolean({ alias: "l", description: "SHOUT IT" }) },

  async run({ args, flags, ui }) {
    // The inference is the point: these annotations must hold.
    const name: string = args.name;
    const loud: boolean = flags.loud;

    const message = `Hello, ${name}!`;
    ui.success(loud ? message.toUpperCase() : message);
  },
});

export const everySpec = defineCommand({
  name: "specs",
  args: {
    required: arg.string(),
    optional: arg.string({ required: false }),
    defaulted: arg.string({ default: "x" }),
    count: arg.number(),
    rest: arg.spread({ required: false }),
  },
  flags: {
    on: flag.boolean(),
    name: flag.string({ alias: "n" }),
    needed: flag.string({ required: true }),
    times: flag.number({ default: 1 }),
    tags: flag.array(),
  },
  allowUnknownFlags: true,

  run({ args, flags, rest }) {
    const a: string = args.required;
    const b: string | undefined = args.optional;
    const c: string = args.defaulted;
    const d: number = args.count;
    const e: string[] = args.rest;

    const f: boolean = flags.on;
    const g: string | undefined = flags.name;
    const h: string = flags.needed;
    const i: number = flags.times;
    const j: string[] = flags.tags;

    void [a, b, c, d, e, f, g, h, i, j, rest];
    return 0; // the exit code
  },
});

export function terminalUi(ui: Ui) {
  ui.info("Checking…");
  ui.success("Migrated 3 tables");
  ui.warning("Nothing to do");
  ui.error("Failed");
  ui.debug("verbose detail");

  ui.action("create", "app/Models/User.ts");
  ui.action("skip", "app/Models/Post.ts", "skipped");

  ui.table(["Name", "Rows"]).row(["users", "42"]).row(["orgs", "7"]).render();

  ui.sticker(["http://localhost:3000"], "Server running");
  ui.instructions(["cd my-app", "npm install", "keel serve"], "Next steps");

  return ui.colors("green", "done");
}

export async function tasks(ui: Ui) {
  return ui
    .tasks()
    .add("Install dependencies", async (task) => {
      task.update("resolving…");
      return "42 packages";
    })
    .add("Run migrations", async () => "3 tables")
    .run();
}

export async function prompts(prompt: Prompt) {
  const name = await prompt.ask("Project name?", { default: "my-app" });
  const secret = await prompt.secure("API key?");
  const ok = await prompt.confirm("Delete everything?");
  const driver = await prompt.choice("Database?", ["sqlite", "postgres"]);
  const features = await prompt.multiple("Features?", ["auth", "queue", "mail"]);

  return { name, secret, ok, driver, features };
}

export async function testingACommand(setup: CommandDefinition) {
  const ui = createUi({ raw: true });
  const prompt = createPrompt({ trap: true });
  const kernel = new ConsoleKernel({ ui, prompt }).register(setup);

  prompt.trap("Project name?").replyWith("keel-app");
  prompt.trap("Database?").chooseOption(1);
  prompt.trap("Write the config?").accept();

  prompt
    .trap("Email?")
    .assertFails("", "Email is required")
    .assertPasses("ada@example.com")
    .replyWith("ada@example.com");

  const code = await kernel.run(["setup"]);

  prompt.assertAllTrapsUsed();

  return { code, logs: ui.logs, errors: ui.errors, plain: stripAnsi(ui.logs.join("\n")) };
}

export async function repl(app: Application, helpers: ReplHelper[]) {
  await startRepl(app, { helpers, prompt: "keel > " });
}
