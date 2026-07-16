import type { ProviderInfo } from "../types";

interface TopBarProps {
  statusMessage: string;
  providers: ProviderInfo[];
}

export function TopBar({ statusMessage, providers }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <h1>PR Review Workbench</h1>
        <p id="statusText">{statusMessage}</p>
      </div>
      <div className="provider-strip" id="providerStrip">
        {providers.map((provider) => (
          <span
            key={provider.name}
            className={`provider-badge ${provider.type}`}
          >
            {provider.name}
          </span>
        ))}
      </div>
    </header>
  );
}
