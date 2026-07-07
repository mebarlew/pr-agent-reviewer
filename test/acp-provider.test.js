import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runAcpProvider } from "../src/providers/acp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("runAcpProvider sends a prompt and collects agent text chunks", async () => {
  const result = await runAcpProvider(
    {
      type: "acp",
      command: process.execPath,
      args: [join(__dirname, "../fixtures/fake-acp-agent.js")],
    },
    {
      prompt: "Review this diff",
      workspace: process.cwd(),
    },
  );

  assert.equal(result.stopReason, "end_turn");
  assert.deepEqual(JSON.parse(result.text), {
    summary: "Fake review complete.",
    findings: [
      {
        path: "src/app.js",
        line: 2,
        severity: "bug",
        comment: "This fake finding proves the ACP path works.",
      },
    ],
  });
});
