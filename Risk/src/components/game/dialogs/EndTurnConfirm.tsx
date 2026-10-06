"use client";

/**
 * The end-turn confirmation (SPEC §7.2) — a full-width **amber banner sliding
 * down from the top**, y 0–440, rounded bottom corners r 20, gradient
 * `--amber-top → --amber-bottom`, 4 px `--amber-border`.
 *
 * It exists because the original ships an `End Phase Confirmation` setting
 * that defaults ON; the sub-note points back at it verbatim.
 */

import { IconButton } from "@/components/ui/IconButton";

import { at, atTopLeft, outlined, Stage } from "./stage";

export interface EndTurnConfirmProps {
  /** `End Turn` in the evidence; the draft/attack ends reuse the same banner. */
  readonly title?: string;
  /** `Skip Fortify phase?` in the evidence. */
  readonly question?: string;
  readonly onYes: () => void;
  readonly onNo: () => void;
}

const NOTE = "(This confirmation can be turned off in game settings)";

export function EndTurnConfirm({
  title = "End Turn", question = "Skip Fortify phase?", onYes, onNo,
}: EndTurnConfirmProps) {
  return (
    <Stage
      testId="end-turn-confirm"
      label={title}
      scrim="var(--scrim)"
      z="var(--z-banner)"
      style={{ alignItems: "flex-start" }}
    >
      <div
        style={{
          ...atTopLeft(0, 0),
          width: "100%",
          height: 440,
          borderBottomLeftRadius: 20,
          borderBottomRightRadius: 20,
          background: "linear-gradient(var(--amber-top), var(--amber-bottom))",
          borderBottom: "4px solid var(--amber-border)",
          animation: "risk-amber-in 280ms cubic-bezier(.16,1,.3,1) both",
        }}
      >
        <style>{"@keyframes risk-amber-in{from{transform:translateY(-100%)}to{transform:none}}"}</style>
      </div>

      <div style={{ ...at(800, 75), ...outlined(58) }}>{title}</div>
      <div
        style={{ ...at(800, 170), fontFamily: "var(--font-head), system-ui, sans-serif",
          fontWeight: 700, fontSize: 34, color: "var(--text-on-amber)", whiteSpace: "nowrap" }}
      >
        {question}
      </div>
      <div
        style={{ ...at(800, 225), fontFamily: "var(--font-body), system-ui, sans-serif",
          fontSize: 22, color: "var(--text-on-amber)", whiteSpace: "nowrap", opacity: 0.85 }}
      >
        {NOTE}
      </div>

      <div style={at(700, 338)}>
        <IconButton chassis="circle" tone="danger" icon="cross" size={108} label="No, keep playing"
          onClick={onNo} testId="end-turn-no" />
      </div>
      <div style={at(900, 338)}>
        <IconButton chassis="circle" tone="go" icon="check" size={108} label="Yes, end the turn"
          onClick={onYes} testId="end-turn-yes" />
      </div>
    </Stage>
  );
}

export default EndTurnConfirm;
