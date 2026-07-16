import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.ts";

test("loadConfig deep merges provider overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pr-agent-reviewer-"));
  const configPath = join(dir, "config.json");

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        providers: {
          codex: {
            env: {
              EXTRA_FLAG: "1",
            },
            timeoutMs: 123,
          },
          local: {
            type: "cli",
            command: "echo",
          },
        },
      }),
    );

    const config = await loadConfig(configPath);

    assert.equal(config.providers.codex.command, "codex-acp");
    assert.deepEqual(config.providers.codex.args, []);
    assert.equal(config.providers.codex.timeoutMs, 123);
    assert.deepEqual(config.providers.codex.env, {
      INITIAL_AGENT_MODE: "read-only",
      EXTRA_FLAG: "1",
    });
    assert.deepEqual(config.providers.local, {
      type: "cli",
      command: "echo",
      args: [],
      env: {},
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig discovers workspace config in a search directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pr-agent-reviewer-"));

  try {
    await writeFile(
      join(dir, ".pr-agent-reviewer.json"),
      JSON.stringify({
        providers: {
          local: {
            type: "cli",
            command: "echo",
          },
        },
      }),
    );

    const config = await loadConfig(undefined, dir);
    assert.equal(config.providers.local.command, "echo");

    const fallback = await loadConfig(undefined, join(dir, "missing"));
    assert.equal(fallback.providers.local, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig returns provider args that are safe to mutate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pr-agent-reviewer-"));

  try {
    const first = await loadConfig(undefined, dir);
    first.providers.codex.args.push("--mutated");

    const second = await loadConfig(undefined, dir);
    assert.deepEqual(second.providers.codex.args, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
