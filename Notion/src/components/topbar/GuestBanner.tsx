"use client";

/**
 * The grey upsell strip Notion shows to guests, directly under the top bar.
 *
 * Dismissal is local state on purpose: it is a per-session nudge, not a
 * preference worth persisting into the document snapshot.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { useWorkspaceStore } from "@/lib/store/workspace-store";

export function GuestBanner() {
  const workspaceName = useWorkspaceStore((s) => s.workspace.name);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="flex shrink-0 items-center justify-center gap-3 px-3 py-[6px]"
      style={{ background: "var(--bac-ter)", fontSize: 13 }}
    >
      <span className="truncate" style={{ color: "var(--tex-sec)" }}>
        You&rsquo;re a guest in {workspaceName}. Get full access to Notion in your own workspace.
      </span>
      <button
        type="button"
        className="shrink-0 rounded-[4px] px-2 py-[3px] text-[13px] font-medium transition-shadow duration-100 outline-hidden"
        style={{
          background: "var(--bac-pri)",
          color: "var(--tex-pri)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        Set up workspace
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] outline-hidden hover:bg-[var(--bac-int-strong)]"
        style={{ color: "var(--ico-sec)" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
