import type { FormEvent } from "react";
import type {
  GithubTokenStatus,
  ProviderInfo,
  PullRequestLink,
  RepoPullRequest,
} from "../types";
import { GitPanel } from "./GitPanel";
import type { GitPanelView } from "./GitPanel";
import { GithubTokenSettings } from "./GithubTokenSettings";
import { RepoPrList } from "./RepoPrList";

interface ReviewFormProps {
  busy: boolean;
  prRef: string;
  providerName: string;
  providers: ProviderInfo[];
  workspace: string;
  gitPanel: GitPanelView;
  githubToken: string;
  githubTokenStatus: GithubTokenStatus | null;
  tokenNotice: string | null;
  repoRef: string;
  repoMeta: string;
  repoPullRequests: RepoPullRequest[] | null;
  onPrRefChange: (value: string) => void;
  onProviderNameChange: (value: string) => void;
  onWorkspaceChange: (value: string) => void;
  onGithubTokenChange: (value: string) => void;
  onRepoRefChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReadGit: () => void;
  onSaveGithubToken: () => void;
  onClearGithubToken: () => void;
  onLoadRepo: () => void;
  onSelectPullRequest: (pullRequest: PullRequestLink) => void;
}

export function ReviewForm({
  busy,
  prRef,
  providerName,
  providers,
  workspace,
  gitPanel,
  githubToken,
  githubTokenStatus,
  tokenNotice,
  repoRef,
  repoMeta,
  repoPullRequests,
  onPrRefChange,
  onProviderNameChange,
  onWorkspaceChange,
  onGithubTokenChange,
  onRepoRefChange,
  onSubmit,
  onReadGit,
  onSaveGithubToken,
  onClearGithubToken,
  onLoadRepo,
  onSelectPullRequest,
}: ReviewFormProps) {
  return (
    <form className="control-panel" id="reviewForm" onSubmit={onSubmit}>
      <div className="panel-title">
        <span>PR Source</span>
        <span className="mode-pill">Local</span>
      </div>

      <label>
        PR link or repo
        <input
          id="prRef"
          name="prRef"
          autoComplete="off"
          placeholder="github.com/org/repo/pull/123 or org/repo"
          required
          value={prRef}
          onChange={(event) => onPrRefChange(event.target.value)}
        />
      </label>

      <label>
        Use
        <select
          id="providerName"
          name="providerName"
          required
          value={providerName}
          onChange={(event) => onProviderNameChange(event.target.value)}
        >
          {providers.map((provider) => (
            <option key={provider.name} value={provider.name}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>

      <details className="advanced">
        <summary>Advanced</summary>
        <label>
          Workspace
          <input
            id="workspace"
            name="workspace"
            autoComplete="off"
            required
            value={workspace}
            onChange={(event) => onWorkspaceChange(event.target.value)}
          />
        </label>
        <button
          id="readGitButton"
          type="button"
          disabled={busy}
          onClick={onReadGit}
        >
          Detect local PR
        </button>
        <GitPanel view={gitPanel} onSelectPullRequest={onSelectPullRequest} />
        <GithubTokenSettings
          value={githubToken}
          status={githubTokenStatus}
          notice={tokenNotice}
          busy={busy}
          onChange={onGithubTokenChange}
          onSave={onSaveGithubToken}
          onClear={onClearGithubToken}
        />
      </details>

      <div className="repo-picker">
        <label>
          Browse repo PRs
          <input
            id="repoRef"
            name="repoRef"
            autoComplete="off"
            placeholder="org/repo"
            value={repoRef}
            onChange={(event) => onRepoRefChange(event.target.value)}
          />
        </label>
        <button
          id="loadRepoButton"
          type="button"
          disabled={busy}
          onClick={onLoadRepo}
        >
          Show PRs
        </button>
      </div>

      <div className="repo-meta" id="repoMeta">
        {repoMeta}
      </div>
      <RepoPrList
        pullRequests={repoPullRequests}
        onSelect={onSelectPullRequest}
      />

      <div className="actions">
        <button
          className="primary"
          id="runButton"
          type="submit"
          disabled={busy}
        >
          Run review
        </button>
      </div>
    </form>
  );
}
