/** Code-generation templates for `keel make:*`. */

export function controllerStub(name: string): string {
  return `import type { Ctx } from "@keel/core";

export class ${name} {
  index(c: Ctx) {
    return c.json({ controller: "${name}", action: "index" });
  }
}
`;
}

export function resourceControllerStub(name: string): string {
  const actions = ["index", "create", "store", "show", "edit", "update", "destroy"];
  const body = actions
    .map((a) => `  ${a}(c: Ctx) {\n    return c.json({ action: "${a}" });\n  }`)
    .join("\n\n");
  return `import type { Ctx } from "@keel/core";

export class ${name} {
${body}
}
`;
}

export function providerStub(name: string): string {
  return `import { ServiceProvider } from "@keel/core";

export class ${name} extends ServiceProvider {
  register(): void {
    // Bind services into the container here.
  }

  boot(): void {
    // Resolve and wire things up here.
  }
}
`;
}

export function middlewareStub(name: string): string {
  const fn = name.charAt(0).toLowerCase() + name.slice(1);
  return `import type { MiddlewareHandler } from "hono";

export const ${fn}: MiddlewareHandler = async (c, next) => {
  // ...before
  await next();
  // ...after
};
`;
}

/** `name` is the model class (e.g. "User") the factory builds. */
export function factoryStub(model: string): string {
  return `import { factory } from "@keel/core";
import { ${model} } from "../../app/Models/${model}.js";

export const ${model.toLowerCase()}Factory = factory(${model}, (f) => ({
  // Describe one ${model}'s attributes; \`f\` is a Faker.
  name: f.name(),
  email: f.email(),
}));
`;
}

export function seederStub(name: string): string {
  return `import { Seeder } from "@keel/core";

export class ${name} extends Seeder {
  async run(): Promise<void> {
    // Populate the database, e.g.:
    // await userFactory.count(10).create();
  }
}
`;
}

export function jobStub(name: string): string {
  return `import { Job } from "@keel/core";

export class ${name} extends Job {
  constructor(/* pass the data this job needs */) {
    super();
  }

  async handle(): Promise<void> {
    // Do the background work here.
  }
}
`;
}

export function notificationStub(name: string): string {
  return `import { Notification, type Notifiable, type MailContent } from "@keel/core";

export class ${name} extends Notification {
  via(_notifiable: Notifiable): string[] {
    return ["mail"];
  }

  toMail(_notifiable: Notifiable): MailContent {
    return {
      subject: "${name}",
      text: "Notification body.",
    };
  }
}
`;
}

/** `name` is the class (e.g. "UserTransformer"); `model` is the value it maps. */
export function transformerStub(name: string, model: string): string {
  return `import { Transformer, type Attributes } from "@keel/core";
// import { ${model} } from "../Models/${model}.js";

export class ${name} extends Transformer</* ${model} */ any> {
  transform(item: /* ${model} */ any): Attributes {
    // Map the value to the exact shape your API exposes.
    return {
      id: item.id,
      // name: item.name,
      // email: this.when(canSeeEmail, item.email),
      // posts: this.whenLoaded(item, "posts", new PostTransformer()),
    };
  }
}
`;
}
