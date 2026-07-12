#!/usr/bin/env tsx
import { run } from "../src/core/cli/index.js";
import { createApplication } from "../bootstrap/app.js";

// The console is handed the application factory rather than importing one, so the
// framework never depends on an app. Your own bin does exactly this.
run(process.argv, { createApplication }).catch((err) => {
  console.error(err);
  process.exit(1);
});
