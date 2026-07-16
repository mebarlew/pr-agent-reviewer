export type TabName = "files" | "prompt";

const TABS: { name: TabName; label: string }[] = [
  { name: "files", label: "Files" },
  { name: "prompt", label: "Fix Prompt" },
];

interface TabBarProps {
  activeTab: TabName;
  onSelect: (name: TabName) => void;
}

export function TabBar({ activeTab, onSelect }: TabBarProps) {
  return (
    <div className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.name}
          type="button"
          className={`tab${tab.name === activeTab ? " active" : ""}`}
          data-tab={tab.name}
          onClick={() => onSelect(tab.name)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
