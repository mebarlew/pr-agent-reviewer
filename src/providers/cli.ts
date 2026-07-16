import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { buildProviderEnv, DEFAULT_PROVIDER_TIMEOUT_MS } from "./env.ts";
import type { ProviderRunOptions, ProviderSpec } from "./env.ts";

export interface CliProviderResult {
  text: string;
  stderr: string;
}

export async function runCliProvider(
  provider: ProviderSpec,
  { prompt, workspace }: ProviderRunOptions,
): Promise<CliProviderResult> {
  const args = (provider.args ?? []).map((arg) =>
    arg === "{prompt}" ? prompt : arg,
  );
  const passesPromptAsArg = args.includes(prompt);
  const timeoutMs = Number(provider.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  const child = spawn(provider.command, args, {
    cwd: workspace,
    env: buildProviderEnv(provider.env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdin.on("error", () => {
    // The child may exit before draining stdin; the exit code carries the real error.
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  if (!passesPromptAsArg) {
    child.stdin.end(prompt);
  } else {
    child.stdin.end();
  }

  const exitCode = await waitForExit(child, timeoutMs, provider.command);

  if (exitCode !== 0) {
    throw new Error(
      `${provider.command} exited with code ${exitCode}.\n${stderr.trim()}`,
    );
  }

  return {
    text: stdout,
    stderr,
  };
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  command: string,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      terminate(child);
      settleReject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    timeout.unref?.();

    function settleResolve(value: number | null): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(value);
    }

    function settleReject(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    }

    child.once("error", settleReject);
    child.once("close", settleResolve);
  });
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill("SIGTERM");

  const killTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGKILL");
    }
  }, 2000);

  killTimer.unref?.();
}
