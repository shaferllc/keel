#!/usr/bin/env tsx
import { run } from "../src/core/cli/index.js";

run(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
