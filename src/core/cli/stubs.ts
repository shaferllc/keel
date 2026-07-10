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
