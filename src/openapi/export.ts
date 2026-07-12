/**
 * `keel openapi:export [--out openapi.json]` — write the spec to a file, for CI,
 * client generation, or committing it. Contributed as a package command.
 */

import type { PackageCommand } from "../core/package.js";
import { defineCommand, flag } from "../core/console.js";
import type { Router } from "../core/http/router.js";
import type { OpenApiConfig } from "./config.js";
import { buildSpec } from "./spec.js";

export function exportCommand(
  getRouter: () => Router,
  config: OpenApiConfig,
  base: string,
): PackageCommand {
  return defineCommand({
    name: "openapi:export",
    description: "Write the OpenAPI spec to a file",
    flags: { out: flag.string({ description: "output path", default: "openapi.json" }) },

    async run({ flags, ui }) {
      const spec = buildSpec(getRouter().all(), config, base);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(flags.out, JSON.stringify(spec, null, 2));
      ui.success(`Wrote ${flags.out} (${Object.keys(spec.paths).length} paths)`);
    },
  }) as PackageCommand;
}
