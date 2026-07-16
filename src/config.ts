import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000;

export interface ProviderConfig {
  type?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs?: number;
  authMethod?: string;
}

export interface ReviewerConfig {
  providers: Record<string, ProviderConfig>;
}

// Shape of the on-disk config file. It is external JSON, so nothing beyond
// the top-level structure is guaranteed.
interface UserConfig {
  providers?: Record<string, Partial<ProviderConfig>>;
}

const DEFAULT_CONFIG: ReviewerConfig = {
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
      env: {},
      timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    },
    gemini: {
      type: "cli",
      command: "gemini",
      args: [],
      env: {},
      timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    },
  },
};

export async function loadConfig(
  configPath?: string,
  searchDir?: string,
): Promise<ReviewerConfig> {
  const path = configPath ? resolve(configPath) : await findConfig(searchDir);

  if (!path) {
    return cloneConfig(DEFAULT_CONFIG);
  }

  const raw = await readFile(path, "utf8");
  const userConfig = JSON.parse(raw) as UserConfig;

  return mergeConfig(DEFAULT_CONFIG, userConfig);
}

async function findConfig(searchDir: string = cwd()): Promise<string | null> {
  const candidate = join(searchDir, ".pr-agent-reviewer.json");

  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function mergeConfig(
  defaultConfig: ReviewerConfig,
  userConfig: UserConfig,
): ReviewerConfig {
  const userProviders = userConfig.providers ?? {};
  const providers: Record<string, ProviderConfig> = {};

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

// User providers are unvalidated JSON, so a merged provider may genuinely
// lack a command; that failure surfaces when the provider is spawned, as it
// did before the type migration.
function mergeProvider(
  defaultProvider: Partial<ProviderConfig>,
  userProvider: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    ...defaultProvider,
    ...userProvider,
    args: [...(userProvider.args ?? defaultProvider.args ?? [])],
    env: {
      ...(defaultProvider.env ?? {}),
      ...(userProvider.env ?? {}),
    },
  } as ProviderConfig;
}

function cloneConfig(config: ReviewerConfig): ReviewerConfig {
  return mergeConfig(config, {});
}
