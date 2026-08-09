"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled active tab id. Omit to let `Tabs` manage its own state. */
  value?: string;
  /** Initial active tab id in uncontrolled mode. Defaults to `tabs[0].id`. */
  defaultValue?: string;
  onChange?: (id: string) => void;
  className?: string;
}

/**
 * A tab-switcher control (SPEC §3.2 SubNav, §3.5 Friends tabs). Renders only
 * the tab strip — callers own the associated panels, keyed off `value` /
 * `onChange`. Client component: it manages the active-tab state itself when
 * uncontrolled.
 */
export function Tabs({ tabs, value, defaultValue, onChange, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id);
  const active = value ?? internal;

  function select(id: string) {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  }

  return (
    <div role="tablist" className={cn("flex items-center gap-5 border-b border-(--border)", className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => select(tab.id)}
            className={cn(
              "relative -mb-px py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
              isActive ? "text-(--text-1)" : "text-(--text-2) hover:text-(--text-1)",
            )}
          >
            {tab.label}
            {isActive ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-(--accent)" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
