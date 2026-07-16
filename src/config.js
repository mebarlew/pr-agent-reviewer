import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000;

const DEFAULT_CONFIG = {
  providers: {
    codex: {
      type: "acp",
      command: "codex-acp",
      args: [],
      env: {
        INITIAL_AGENT_MODE: "read-only",
      },
      timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    },
    claude: {
      type: "acp",
      command: "claude-agent-acp",
      args: [],
      timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    },
    gemini: {
      type: "cli",
      command: "gemini",
      args: [],
      timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    },
  },
};

export async function loadConfig(configPath, searchDir) {
  const path = configPath ? resolve(configPath) : await findConfig(searchDir);

  if (!path) {
    return cloneConfig(DEFAULT_CONFIG);
  }

  const raw = await readFile(path, "utf8");
  const userConfig = JSON.parse(raw);

  return mergeConfig(DEFAULT_CONFIG, userConfig);
}

async function findConfig(searchDir = cwd()) {
  const candidate = join(searchDir, ".pr-agent-reviewer.json");

  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function mergeConfig(defaultConfig, userConfig) {
  const userProviders = userConfig.providers ?? {};
  const providers = {};

  for (const [name, provider] of Object.entries(defaultConfig.providers)) {
    providers[name] = mergeProvider(provider, userProviders[name]);
  }

  for (const [name, provider] of Object.entries(userProviders)) {
    if (!providers[name]) {
      providers[name] = mergeProvider({}, provider);
    }
  }

  return {
    ...defaultConfig,
    ...userConfig,
    providers,
  };
}

function mergeProvider(defaultProvider, userProvider = {}) {
  return {
    ...defaultProvider,
    ...userProvider,
    args: [...(userProvider.args ?? defaultProvider.args ?? [])],
    env: {
      ...(defaultProvider.env ?? {}),
      ...(userProvider.env ?? {}),
    },
  };
}

function cloneConfig(config) {
  return mergeConfig(config, {});
}
