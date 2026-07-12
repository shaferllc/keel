/**
 * `keel openapi:export [--out openapi.json]` — write the spec to a file, for CI,
 * client generation, or committing it. Contributed as a package command.
 */

import type { PackageCommand } from "../core/package.js";
import type { Router } from "../core/http/router.js";
import type { OpenApiConfig } from "./config.js";
import { buildSpec } from "./spec.js";

export function exportCommand(
  getRouter: () => Router,
  config: OpenApiConfig,
  base: string,
): PackageCommand {
  return {
    name: "openapi:export",
    description: "Write the OpenAPI spec to a file",
    configure: (cmd) => cmd.option("--out <file>", "output path", "openapi.json"),
    action: async (opts) => {
      const spec = buildSpec(getRouter().all(), config, base);
      const out = String(opts.out ?? "openapi.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(out, JSON.stringify(spec, null, 2));
      console.log(`✓ Wrote ${out} (${Object.keys(spec.paths).length} paths)`);
    },
  };
}
