import type { RepoPullRequest } from "../types";

interface RepoPrListProps {
  pullRequests: RepoPullRequest[] | null;
  onSelect: (pullRequest: RepoPullRequest) => void;
}

export function RepoPrList({ pullRequests, onSelect }: RepoPrListProps) {
  return (
    <div className="repo-pr-list" id="repoPrList">
      {pullRequests?.length === 0 && (
        <p className="empty">No open PRs found.</p>
      )}
      {pullRequests?.map((pullRequest) => (
        <button
          key={pullRequest.number}
          type="button"
          className={`repo-pr ${pullRequest.reviewState}`}
          onClick={() => onSelect(pullRequest)}
        >
          <strong>
            #{pullRequest.number} {pullRequest.title}
          </strong>
          <span>
            {pullRequest.reviewState.replace("_", " ")} / {pullRequest.author}
          </span>
        </button>
      ))}
    </div>
  );
}
