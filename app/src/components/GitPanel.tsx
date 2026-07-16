import type { GitStateResult, PullRequestLink } from "../types";

export type GitPanelView =
  | { kind: "initial" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; result: GitStateResult };

interface GitPanelProps {
  view: GitPanelView;
  onSelectPullRequest: (pullRequest: PullRequestLink) => void;
}

export function GitPanel({ view, onSelectPullRequest }: GitPanelProps) {
  if (view.kind === "initial") {
    return (
      <div className="git-panel" id="gitPanel">
        <p>Local git not checked.</p>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <div className="git-panel error" id="gitPanel">
        <strong>Could not read git</strong>
        <p>{view.message}</p>
      </div>
    );
  }

  const { result } = view;

  return (
    <div className="git-panel" id="gitPanel">
      <strong>
        {result.branch ? `Branch ${result.branch}` : "Detached HEAD"}
      </strong>
      <p>
        {result.changedFiles} changed files /{" "}
        {result.isDirty ? "dirty" : "clean"}
      </p>
      {result.github && (
        <p>
          {result.github.base.fullName} via{" "}
          {result.github.remotes.map((remote) => remote.name).join(", ")}
        </p>
      )}
      {result.pullRequests.length === 0 ? (
        <p>
          {result.github
            ? "No open PR found for this branch."
            : "No GitHub remote detected."}
        </p>
      ) : (
        <div className="pr-candidates">
          {result.pullRequests.map((pullRequest) => (
            <button
              key={pullRequest.number}
              type="button"
              className="pr-candidate"
              onClick={() => onSelectPullRequest(pullRequest)}
            >
              #{pullRequest.number} {pullRequest.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
