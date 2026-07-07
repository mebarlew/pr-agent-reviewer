import { runAcpProvider } from "./acp.js";
import { runCliProvider } from "./cli.js";

export async function runProvider(provider, options) {
  if (provider.type === "acp") {
    return runAcpProvider(provider, options);
  }

  if (provider.type === "cli") {
    return runCliProvider(provider, options);
  }

  throw new Error(`Unsupported provider type "${provider.type}"`);
}
