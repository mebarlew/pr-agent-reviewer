import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderEnv } from "../src/providers/env.js";

test("buildProviderEnv does not pass GitHub tokens unless explicitly configured", () => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "secret";

  try {
    assert.equal(buildProviderEnv().GITHUB_TOKEN, undefined);
    assert.equal(
      buildProviderEnv({ GITHUB_TOKEN: "explicit" }).GITHUB_TOKEN,
      "explicit",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previous;
    }
  }
});
