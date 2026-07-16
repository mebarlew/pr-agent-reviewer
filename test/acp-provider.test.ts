import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runAcpProvider } from "../src/providers/acp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("runAcpProvider sends a prompt and collects agent text chunks", async () => {
  const result = await runAcpProvider(
    {
      type: "acp",
      command: process.execPath,
      args: [join(__dirname, "../fixtures/fake-acp-agent.ts")],
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

test("runAcpProvider survives malformed updates and keeps tool output out of the answer", async () => {
  const result = await runAcpProvider(
    {
      type: "acp",
      command: process.execPath,
      args: [join(__dirname, "../fixtures/fake-acp-agent.ts")],
    },
    {
      prompt: "Review this diff (noisy)",
      workspace: process.cwd(),
    },
  );

  assert.equal(result.stopReason, "end_turn");
  assert.equal(JSON.parse(result.text).summary, "Fake review complete.");
  assert.ok(!result.text.includes("function boom"));
});

test("JsonRpcStdioClient rejects pending requests when the agent exits without reading stdin", async () => {
  const { JsonRpcStdioClient } =
    await import("../src/providers/json-rpc-stdio.ts");
  const client = new JsonRpcStdioClient({
    command: process.execPath,
    args: ["-e", "setTimeout(() => process.exit(3), 100)"],
    cwd: process.cwd(),
  });

  try {
    await assert.rejects(
      client.request(
        "initialize",
        { padding: "x".repeat(2 * 1024 * 1024) },
        10_000,
      ),
      /exited with code 3/,
    );
  } finally {
    await client.close();
  }
});

test("JsonRpcStdioClient rejects pending requests when the agent exits cleanly", async () => {
  const { JsonRpcStdioClient } =
    await import("../src/providers/json-rpc-stdio.ts");
  const client = new JsonRpcStdioClient({
    command: process.execPath,
    args: ["-e", "setTimeout(() => process.exit(0), 100)"],
    cwd: process.cwd(),
  });

  try {
    await assert.rejects(
      client.request("initialize", {}, 10_000),
      /exited with code 0 before responding/,
    );
  } finally {
    await client.close();
  }
});
