"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";

export interface MarketDetailTabsProps {
  /** Pre-built panel content per tab (Server Components rendered up in
   * `page.tsx` and passed straight through — only the tab SWITCHER itself
   * needs to be a client component). */
  position: ReactNode;
  holders: ReactNode;
  rules: ReactNode;
  activity: ReactNode;
  className?: string;
}

const TABS = [
  { id: "position", label: "Your position" },
  { id: "holders", label: "Holders" },
  { id: "rules", label: "Rules & resolution" },
  { id: "activity", label: "Activity" },
] as const;

/** "Your position / Holders / Rules & resolution / Activity" tabs (SPEC
 * §3.3). Thin client wrapper around Task 8's `Tabs` primitive — it only
 * owns which panel is currently shown; every panel's actual content is
 * built server-side by the caller. */
export function MarketDetailTabs({ position, holders, rules, activity, className }: MarketDetailTabsProps) {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("position");

  const panel = {
    position,
    holders,
    rules,
    activity,
  }[active];

  return (
    <div className={className}>
      <Tabs tabs={[...TABS]} value={active} onChange={(id) => setActive(id as (typeof TABS)[number]["id"])} />
      <div className="pt-4">{panel}</div>
    </div>
  );
}
