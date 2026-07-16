import type { GithubTokenStatus } from "../types";

interface GithubTokenSettingsProps {
  value: string;
  status: GithubTokenStatus | null;
  notice: string | null;
  busy: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
}

export function GithubTokenSettings({
  value,
  status,
  notice,
  busy,
  onChange,
  onSave,
  onClear,
}: GithubTokenSettingsProps) {
  return (
    <>
      <label>
        GitHub token
        <input
          id="githubToken"
          name="githubToken"
          type="password"
          autoComplete="off"
          placeholder={status?.hasGithubToken ? "token available" : "optional"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="token-actions">
        <button
          id="saveGithubTokenButton"
          type="button"
          disabled={busy || !status?.canPersistGithubToken}
          onClick={onSave}
        >
          Save token
        </button>
        <button
          id="clearGithubTokenButton"
          type="button"
          disabled={busy || !status?.hasStoredGithubToken}
          onClick={onClear}
        >
          Forget
        </button>
      </div>
      <div className="token-status" id="githubTokenStatus">
        {notice ?? tokenStatusText(status)}
      </div>
    </>
  );
}

function tokenStatusText(status: GithubTokenStatus | null): string {
  if (!status) {
    return "Token status unavailable";
  }

  if (status.hasStoredGithubToken && status.canPersistGithubToken) {
    return "Saved token";
  }

  if (status.hasStoredGithubToken) {
    return status.reason;
  }

  if (status.envGithubToken) {
    return "Using env token";
  }

  return status.canPersistGithubToken ? "No saved token" : status.reason;
}
