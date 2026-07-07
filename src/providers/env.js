import { DEFAULT_PROVIDER_TIMEOUT_MS } from "../config.js";

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

export function buildProviderEnv(extraEnv = {}) {
  const env = {};

  for (const key of PASS_THROUGH_ENV_KEYS) {
    if (typeof process.env[key] === "string") {
      env[key] = process.env[key];
    }
  }

  return {
    ...env,
    ...extraEnv,
  };
}
