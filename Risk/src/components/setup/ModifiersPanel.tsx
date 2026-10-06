"use client";

/**
 * The per-seat panel the `/new/rules` `Modifiers` button opens (SPEC §7):
 * the seat rows (2–6) over `RulesControls`, which carries the rest of the
 * `Rules` interface.
 *
 * It owns no state of its own — every control writes straight into the
 * session-config store through the callbacks, so the readout, the modifier
 * stack and this panel are three views of one `Rules`.
 */
import type { PlayerColour, Rules, SeatConfig } from "@/engine/types";
import { MAX_SEATS } from "@/engine/types";

import { IconButton } from "../ui/IconButton";
import { RulesControls } from "./RulesControls";
import { SeatRow } from "./SeatRow";

export interface ModifiersPanelProps {
  readonly seats: readonly SeatConfig[];
  readonly rules: Rules;
  readonly online: boolean;
  readonly onSeatChange: (index: number, patch: Partial<SeatConfig>) => void;
  readonly onSeatCount: (count: number) => void;
  readonly onRulesChange: (patch: Partial<Rules>) => void;
  readonly onClose: () => void;
}

export function ModifiersPanel({
  seats,
  rules,
  online,
  onSeatChange,
  onSeatCount,
  onRulesChange,
  onClose,
}: ModifiersPanelProps) {
  const canAdd = seats.length < MAX_SEATS;
  const canRemove = seats.length > 2;

  return (
    <div
      data-testid="modifiers-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Modifiers"
      className="fixed inset-0 flex items-start justify-center overflow-y-auto px-3 py-6"
      style={{ zIndex: "var(--z-modal)", background: "var(--scrim-heavy)" }}
    >
      <div
        className="flex w-full max-w-[860px] flex-col gap-4 p-4"
        style={{
          background: "var(--chrome-800)",
          border: "2px solid var(--chrome-line)",
          borderRadius: "var(--r-panel)",
          boxShadow: "var(--sh-panel)",
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="on-board-text" style={{ fontSize: "clamp(22px, 3.2vw, 34px)" }}>
            Modifiers
          </h2>
          <IconButton icon="cross" label="Close modifiers" tone="danger" size={44} testId="modifiers-close" onClick={onClose} />
        </div>

        <div className="flex items-center justify-between">
          <span className="font-head font-bold" style={{ color: "var(--text)" }}>
            Players <span data-testid="seat-count">{seats.length}</span>/{MAX_SEATS}
          </span>
          <button
            type="button"
            data-testid="seat-add"
            disabled={!canAdd}
            onClick={() => onSeatCount(seats.length + 1)}
            className="rounded-[var(--r-pill)] px-4 font-head font-bold outline-none disabled:opacity-30"
            style={{
              minHeight: 44,
              background: "linear-gradient(var(--go), var(--go-mid))",
              border: "2px solid var(--go-deep)",
              color: "var(--text)",
            }}
          >
            Add seat
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {seats.map((seat, index) => (
            <SeatRow
              key={index}
              index={index}
              seat={seat}
              taken={seats.filter((_, i) => i !== index).map((s) => s.colour) as readonly PlayerColour[]}
              canRemove={canRemove}
              // `setSeatCount` truncates, so only the last row can be dropped;
              // any other seat is emptied by retyping it, never by a hole.
              onRemove={index === seats.length - 1 ? () => onSeatCount(seats.length - 1) : undefined}
              onChange={(patch) => onSeatChange(index, patch)}
            />
          ))}
        </div>

        <RulesControls rules={rules} onChange={onRulesChange} online={online} />
      </div>
    </div>
  );
}

export default ModifiersPanel;
