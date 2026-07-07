#!/usr/bin/env node

import { main } from "../src/cli.js";

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
