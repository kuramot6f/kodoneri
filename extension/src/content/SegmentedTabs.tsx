import type { CSSProperties } from "react";

interface SegmentedTabsProps<T extends string> {
  tabs: ReadonlyArray<{ value: T; label: string; title: string }>;
  value: T;
  onChange: (value: T) => void;
}

/** Pill-shaped glass switcher with a sliding highlight behind the selected tab. */
export function SegmentedTabs<T extends string>({ tabs, value, onChange }: SegmentedTabsProps<T>) {
  const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.value === value));
  return (
    <div className="segmented" role="tablist" style={{ "--tab-count": tabs.length, "--tab-index": selectedIndex } as CSSProperties}>
      <span className="segmented-thumb" aria-hidden="true" />
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          title={tab.title}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
