import type { EditableFinding } from "../types";

const SEVERITIES = [
  "bug",
  "security",
  "performance",
  "maintainability",
  "test",
  "question",
];

interface FindingCardProps {
  finding: EditableFinding;
  resolvedBy: string | null | undefined;
  onChange: (id: string, patch: Partial<EditableFinding>) => void;
}

export function FindingCard({
  finding,
  resolvedBy,
  onChange,
}: FindingCardProps) {
  const resolved = resolvedBy !== undefined;

  return (
    <article
      className={`finding${resolved ? " resolved" : ""}`}
      data-path={finding.path}
      data-line={finding.line}
      data-kind={finding.kind}
      data-severity={finding.severity}
    >
      <div className="finding-head">
        <label className="checkline">
          <input
            className="finding-selected"
            type="checkbox"
            checked={finding.selected}
            onChange={(event) =>
              onChange(finding.id, { selected: event.target.checked })
            }
          />
          <span className="finding-location">
            {finding.path}:{finding.line}
          </span>
        </label>
        <select
          className="finding-severity"
          value={finding.severity}
          onChange={(event) =>
            onChange(finding.id, { severity: event.target.value })
          }
        >
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>
        <span className="finding-resolved" hidden={!resolved}>
          {resolved
            ? resolvedBy
              ? `Resolved by ${resolvedBy}`
              : "Resolved"
            : ""}
        </span>
      </div>
      <textarea
        className="finding-comment"
        rows={4}
        value={finding.comment}
        onChange={(event) =>
          onChange(finding.id, { comment: event.target.value })
        }
      />
      <textarea
        className="finding-suggestion"
        rows={3}
        placeholder="Suggested direction"
        value={finding.suggestion}
        onChange={(event) =>
          onChange(finding.id, { suggestion: event.target.value })
        }
      />
    </article>
  );
}
