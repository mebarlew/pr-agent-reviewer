import type { ChangedFile } from "../types";
import { DiffView } from "./DiffView";

interface FilesPanelProps {
  active: boolean;
  files: ChangedFile[] | null;
  selectedFileIndex: number;
  onSelectFile: (index: number) => void;
}

export function FilesPanel({
  active,
  files,
  selectedFileIndex,
  onSelectFile,
}: FilesPanelProps) {
  return (
    <div className={`tab-panel${active ? " active" : ""}`} id="filesPanel">
      {files === null ? (
        <p className="empty">Run a review to inspect changed files.</p>
      ) : files.length === 0 ? (
        <p className="empty">No changed files returned for this PR.</p>
      ) : (
        <FilesLayout
          files={files}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={onSelectFile}
        />
      )}
    </div>
  );
}

interface FilesLayoutProps {
  files: ChangedFile[];
  selectedFileIndex: number;
  onSelectFile: (index: number) => void;
}

function FilesLayout({
  files,
  selectedFileIndex,
  onSelectFile,
}: FilesLayoutProps) {
  const activeIndex = Math.min(
    selectedFileIndex,
    Math.max(files.length - 1, 0),
  );
  const totals = files.reduce(
    (memo, file) => ({
      additions: memo.additions + (file.additions ?? 0),
      deletions: memo.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );

  return (
    <div className="files-layout">
      <aside className="files-sidebar">
        <div className="files-summary">
          {files.length} files changed / +{totals.additions} -{totals.deletions}
        </div>
        <div className="file-list">
          {files.map((file, index) => (
            <button
              key={file.filename}
              type="button"
              className={`file-row ${file.status ?? "changed"}${
                index === activeIndex ? " active" : ""
              }`}
              onClick={() => onSelectFile(index)}
            >
              <strong>{file.filename}</strong>
              <span>
                {file.status ?? "changed"} / +{file.additions ?? 0} -
                {file.deletions ?? 0}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="file-diff-pane">
        <DiffView file={files[activeIndex]} />
      </section>
    </div>
  );
}
