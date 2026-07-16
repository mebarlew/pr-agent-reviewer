import type { ChangedFile } from "../types";

interface DiffViewProps {
  file: ChangedFile;
}

export function DiffView({ file }: DiffViewProps) {
  return (
    <article className="file-diff">
      <div className="file-diff-header">
        <strong>{file.filename}</strong>
        <span>
          {file.status ?? "changed"} / +{file.additions ?? 0} -
          {file.deletions ?? 0}
        </span>
      </div>
      {!file.patchAvailable || !file.patch ? (
        <p className="file-patch-empty">
          Patch not available from GitHub for this file.
        </p>
      ) : (
        <pre className="diff-view">
          {file.patch.split("\n").map((line, index) => (
            <code key={index} className={`diff-line ${diffLineClass(line)}`}>
              {line || " "}
            </code>
          ))}
        </pre>
      )}
    </article>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) {
    return "hunk";
  }

  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "added";
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return "removed";
  }

  return "context";
}
