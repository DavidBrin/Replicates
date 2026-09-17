"use client";

import type { ReactNode } from "react";

export interface WindowPanelTab {
  id: string;
  label: string;
}

export interface WindowPanelProps {
  /** Title bar text, e.g. `"Channel rack"`, `"Piano roll - <channel>"` (lane 1 §1.1). */
  title: string;
  className?: string;
  children: ReactNode;
  tabs?: WindowPanelTab[];
  activeTabId?: string;
  onTabChange?: (id: string) => void;
}

/**
 * FL-style docked window chrome (SPEC §4.1): a slim title bar over a body,
 * no floating/draggable behaviour — this replica's windows are fixed grid
 * regions, only the title-bar *idea* survives (lane 1 §1.1).
 */
export function WindowPanel({
  title,
  className,
  children,
  tabs,
  activeTabId,
  onTabChange,
}: WindowPanelProps) {
  return (
    <section className={`fl-window ${className ?? ""}`.trim()}>
      <div className="fl-window__titlebar">
        <span className="fl-window__title">{title}</span>
        {tabs && tabs.length > 0 && (
          <div className="fl-window__tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTabId}
                data-active={tab.id === activeTabId}
                className="fl-window__tab"
                onClick={() => onTabChange?.(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="fl-window__body">{children}</div>
    </section>
  );
}
