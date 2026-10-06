"use client";

/**
 * The 42-line dialog roster of SPEC §7.3.
 *
 * Full-width light pills, grouped by category with the group label above each
 * group, scrollable. Lines 28 and 29 are ally-only and are offered only while
 * an alliance is active. The text itself lives in `@/content/dialog` and is
 * never restated here — five of the lines are RGD-verbatim.
 */

import clsx from "clsx";

import { linesByGroup, type DialogLine } from "@/content/dialog";
import type { ChatSend } from "@/ports/sync";

export interface DialogRosterProps {
  /** Lines 28 and 29 appear only while an alliance is active. */
  readonly allied: boolean;
  /** Fires `{ lineId: n }` — the roster index is the only thing sent (§7.3). */
  readonly onSend: (send: ChatSend) => void;
  readonly className?: string;
}

/* The pill face. §7.3 quotes `#DFE3E6` and it has no token in globals.css. */
const PILL_FACE = "#DFE3E6";

export function DialogRoster({ allied, onSend, className }: DialogRosterProps) {
  const groups = linesByGroup();
  return (
    <div
      data-testid="dialog-roster"
      role="group"
      aria-label="Dialog roster"
      className={clsx("dialog-roster", className)}
      style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "4px 10px 10px",
        display: "flex", flexDirection: "column", gap: 10 }}
    >
      {groups.map((group) => {
        const lines = group.lines.filter((l: DialogLine) => allied || l.allyOnly !== true);
        if (lines.length === 0) return null;
        return (
          <section key={group.group} data-testid={`dialog-group-${group.group}`}>
            <h3
              style={{
                fontFamily: "var(--font-head), system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "6px 2px 6px",
              }}
            >
              {group.label}
            </h3>
            <ul style={{ display: "flex", flexDirection: "column", gap: 6, listStyle: "none",
              margin: 0, padding: 0 }}>
              {lines.map((line) => (
                <li key={line.id}>
                  <button
                    type="button"
                    data-testid={`dialog-line-${line.id}`}
                    data-line-id={line.id}
                    onClick={() => onSend({ lineId: line.id })}
                    style={{
                      width: "100%",
                      height: 46,
                      borderRadius: 23,
                      background: PILL_FACE,
                      color: "var(--text-on-paper)",
                      fontFamily: "var(--font-body), system-ui, sans-serif",
                      fontWeight: 600,
                      fontSize: 16,
                      textAlign: "center",
                      padding: "0 14px",
                      border: "none",
                      cursor: "pointer",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {line.text}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default DialogRoster;
