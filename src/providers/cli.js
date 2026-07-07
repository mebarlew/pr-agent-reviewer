import { spawn } from "node:child_process";
import { buildProviderEnv, DEFAULT_PROVIDER_TIMEOUT_MS } from "./env.js";

export async function runCliProvider(provider, { prompt, workspace }) {
  const args = (provider.args ?? []).map((arg) => (arg === "{prompt}" ? prompt : arg));
  const passesPromptAsArg = args.includes(prompt);
  const timeoutMs = Number(provider.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  const child = spawn(provider.command, args, {
    cwd: workspace,
    env: buildProviderEnv(provider.env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  if (!passesPromptAsArg) {
    child.stdin.end(prompt);
  } else {
    child.stdin.end();
  }

  const exitCode = await waitForExit(child, timeoutMs, provider.command);

  if (exitCode !== 0) {
    throw new Error(`${provider.command} exited with code ${exitCode}.\n${stderr.trim()}`);
  }

  return {
    text: stdout,
    stderr,
  };
}

function waitForExit(child, timeoutMs, command) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      terminate(child);
      settleReject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    timeout.unref?.();

    function settleResolve(value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(value);
    }

    function settleReject(error) {
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

function terminate(child) {
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
