#!/usr/bin/env node

import { main } from "../src/cli.ts";

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
