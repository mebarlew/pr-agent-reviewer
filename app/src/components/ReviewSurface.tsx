import type { ChangedFile } from "../types";
import { FilesPanel } from "./FilesPanel";
import { TabBar } from "./TabBar";
import type { TabName } from "./TabBar";

interface ReviewSurfaceProps {
  prTitle: string;
  counts: string;
  activeTab: TabName;
  files: ChangedFile[] | null;
  selectedFileIndex: number;
  fixPrompt: string;
  onSelectTab: (name: TabName) => void;
  onSelectFile: (index: number) => void;
}

export function ReviewSurface({
  prTitle,
  counts,
  activeTab,
  files,
  selectedFileIndex,
  fixPrompt,
  onSelectTab,
  onSelectFile,
}: ReviewSurfaceProps) {
  return (
    <section className="review-surface" aria-live="polite">
      <div className="summary-row">
        <div>
          <span className="meta-label">Diff workspace</span>
          <strong id="prTitle">{prTitle}</strong>
        </div>
        <div className="counts" id="counts">
          {counts}
        </div>
      </div>

      <TabBar activeTab={activeTab} onSelect={onSelectTab} />

      <FilesPanel
        active={activeTab === "files"}
        files={files}
        selectedFileIndex={selectedFileIndex}
        onSelectFile={onSelectFile}
      />
      <pre
        className={`tab-panel raw-output${activeTab === "prompt" ? " active" : ""}`}
        id="promptPanel"
      >
        {fixPrompt}
      </pre>
    </section>
  );
}
