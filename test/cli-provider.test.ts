import assert from "node:assert/strict";
import test from "node:test";
import { runCliProvider } from "../src/providers/cli.ts";

test("runCliProvider rejects gracefully when the command exits without reading stdin", async () => {
  await assert.rejects(
    runCliProvider(
      {
        type: "cli",
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
        timeoutMs: 10_000,
      },
      {
        prompt: "x".repeat(2 * 1024 * 1024),
        workspace: process.cwd(),
      },
    ),
    /exited with code 7/,
  );
});

test("runCliProvider resolves when the command succeeds without reading stdin", async () => {
  const result = await runCliProvider(
    {
      type: "cli",
      command: process.execPath,
      args: ["-e", "console.log('ok')"],
      timeoutMs: 10_000,
    },
    {
      prompt: "x".repeat(2 * 1024 * 1024),
      workspace: process.cwd(),
    },
  );

  assert.equal(result.text.trim(), "ok");
});
