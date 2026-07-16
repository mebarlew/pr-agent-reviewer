import { runAcpProvider } from "./acp.ts";
import { runCliProvider } from "./cli.ts";
import type {
  ProviderResult,
  ProviderRunOptions,
  ProviderSpec,
} from "./env.ts";

export async function runProvider(
  provider: ProviderSpec,
  options: ProviderRunOptions,
): Promise<ProviderResult> {
  if (provider.type === "acp") {
    return runAcpProvider(provider, options);
  }

  if (provider.type === "cli") {
    return runCliProvider(provider, options);
  }

  throw new Error(`Unsupported provider type "${provider.type}"`);
}
