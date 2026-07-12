#!/usr/bin/env tsx
/**
 * The application console. `npm run keel <command>`.
 *
 * The commands — serve, routes, repl, migrate:*, every make:* — come from the
 * framework. This file only says how to build *your* application.
 */
import { run } from "@shaferllc/keel/cli";

import { createApplication } from "../bootstrap/app.js";

run(process.argv, { createApplication }).catch((error) => {
  console.error(error);
  process.exit(1);
});
