import type { EditableFinding } from "../types";
import { FindingCard } from "./FindingCard";

interface FindingsDockProps {
  summary: string;
  summaryEnabled: boolean;
  findings: EditableFinding[] | null;
  resolvedThreads: Map<string, string | null>;
  copyDisabled: boolean;
  postDisabled: boolean;
  onSummaryChange: (value: string) => void;
  onFindingChange: (id: string, patch: Partial<EditableFinding>) => void;
  onCopyPrompt: () => void;
  onPost: () => void;
}

export function FindingsDock({
  summary,
  summaryEnabled,
  findings,
  resolvedThreads,
  copyDisabled,
  postDisabled,
  onSummaryChange,
  onFindingChange,
  onCopyPrompt,
  onPost,
}: FindingsDockProps) {
  return (
    <aside className="review-dock" aria-label="AI review findings">
      <div className="dock-title">
        <span>AI Review</span>
        <span className="mode-pill">Draft</span>
      </div>

      <label className="summary-editor">
        Summary
        <textarea
          id="summary"
          rows={5}
          disabled={!summaryEnabled}
          value={summary}
          onChange={(event) => onSummaryChange(event.target.value)}
        />
      </label>

      <div className="dock-comments" id="commentsPanel">
        {findings === null ? (
          <p className="empty">Run a review to see findings here.</p>
        ) : findings.length === 0 ? (
          <p className="empty">No findings.</p>
        ) : (
          findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              resolvedBy={resolvedThreads.get(
                `${finding.path}:${finding.line}`,
              )}
              onChange={onFindingChange}
            />
          ))
        )}
      </div>

      <div className="result-actions">
        <button
          id="copyPromptButton"
          type="button"
          disabled={copyDisabled}
          onClick={onCopyPrompt}
        >
          Copy fix prompt
        </button>
        <button
          id="postButton"
          type="button"
          disabled={postDisabled}
          onClick={onPost}
        >
          Post comments
        </button>
      </div>
    </aside>
  );
}
