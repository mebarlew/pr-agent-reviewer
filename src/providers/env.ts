import { DEFAULT_PROVIDER_TIMEOUT_MS } from "../config.ts";

// The minimum a provider runner needs to spawn an agent. `ProviderConfig`
// from the merged config is assignable to this shape.
export interface ProviderSpec {
  type?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  authMethod?: string;
}

export interface ProviderRunOptions {
  prompt: string;
  workspace: string;
}

export interface ProviderResult {
  text: string;
  stderr: string;
  stopReason?: string;
  updates?: unknown[];
}

const PASS_THROUGH_ENV_KEYS = [
  "APPDATA",
  "ComSpec",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "LOGNAME",
  "PATH",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "WINDIR",
];

export { DEFAULT_PROVIDER_TIMEOUT_MS };

export function buildProviderEnv(
  extraEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of PASS_THROUGH_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return {
    ...env,
    ...extraEnv,
  };
}
