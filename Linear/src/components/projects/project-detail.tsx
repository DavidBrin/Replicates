"use client";

/**
 * The Overview / Updates switch.
 *
 * A Client Component that takes already-rendered Server Components as
 * `children` props. That is the whole trick: the tab state is interactive and
 * has to be in the browser, but the issue list, the milestones and the update
 * feed are read-only server-rendered markup and there is no reason to ship
 * their data twice. Passing them as elements keeps the boundary at the smallest
 * thing that actually needs it.
 *
 * ## Both panels stay mounted
 *
 * The inactive one is hidden with `hidden`, not unmounted. Two reasons: the
 * project's issues are part of the page for anything that reads it — the
 * permission journey asserts a newly created issue appears in
 * `project-issues` without touching a tab — and re-mounting a feed on every tab
 * click throws away scroll position for no gain on a page this size.
 */

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

type Tab = "overview" | "updates";

export interface ProjectDetailProps {
  header: ReactNode;
  overview: ReactNode;
  updates: ReactNode;
  /** Shown beside the tab label, so "3 updates" is visible without switching. */
  updateCount: number;
}

export function ProjectDetail({
  header,
  overview,
  updates,
  updateCount,
}: ProjectDetailProps) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="flex flex-col gap-4">
      {header}

      <div role="tablist" aria-label="Project sections" className="flex gap-1">
        <TabButton
          id="overview"
          current={tab}
          onSelect={setTab}
          label="Overview"
        />
        <TabButton
          id="updates"
          current={tab}
          onSelect={setTab}
          label="Updates"
          badge={updateCount === 0 ? undefined : String(updateCount)}
        />
      </div>

      <div
        role="tabpanel"
        aria-label="Overview"
        hidden={tab !== "overview"}
        className="flex flex-col gap-6"
      >
        {overview}
      </div>
      <div role="tabpanel" aria-label="Updates" hidden={tab !== "updates"}>
        {updates}
      </div>
    </div>
  );
}

function TabButton({
  id,
  current,
  onSelect,
  label,
  badge,
}: {
  id: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  label: string;
  badge?: string;
}) {
  const active = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => {
        onSelect(id);
      }}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-small",
        "transition-colors duration-[var(--speed-quick)]",
        active
          ? "bg-selected text-primary"
          : "text-tertiary hover:bg-hover hover:text-primary",
      )}
    >
      {label}
      {badge === undefined ? null : (
        <span className="text-micro text-quaternary">{badge}</span>
      )}
    </button>
  );
}
