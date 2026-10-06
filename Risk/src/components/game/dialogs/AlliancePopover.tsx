"use client";

/**
 * The alliance popover: Propose / Accept / Break, popped to the left of a roster capsule (R80, §7.1).
 *
 * Small on purpose. An alliance is three actions and a piece of social information, so the control
 * is three buttons and a line of status — no modal, no takeover, no board state of its own. It is
 * mounted next to the capsule it belongs to, which is why it positions itself with `right-full`
 * exactly as the chat balloon does.
 *
 * `ALLIANCE_PROPOSE` changes no `GameState` field, so "a proposal is in the air" is UI state the
 * session keeps (`allianceOffers`) and this component only renders.
 */
import type { PlayerColour } from "@/engine/types";
import { playerVar } from "@/render/palette";

export interface AlliancePopoverProps {
  /** The seat this popover is about — never the viewer's own. */
  readonly seat: number;
  readonly name: string;
  readonly colour: PlayerColour;
  /** We are already allied with them. */
  readonly allied: boolean;
  /** They have offered us an alliance. */
  readonly offeredToMe: boolean;
  /** We have offered them one and they have not answered. */
  readonly offeredByMe: boolean;
  /** A fresh proposal is legal right now (`legalActions` says so). */
  readonly canPropose: boolean;
  readonly onPropose: () => void;
  readonly onAccept: () => void;
  readonly onBreak: () => void;
  readonly onClose: () => void;
}

function Action({ label, testId, tone, onClick }: {
  readonly label: string;
  readonly testId: string;
  readonly tone: "go" | "danger" | "neutral";
  readonly onClick: () => void;
}) {
  const background = tone === "go"
    ? "linear-gradient(var(--go), var(--go-mid))"
    : tone === "danger" ? "var(--danger)" : "var(--chrome-900)";
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="w-full rounded-[var(--r-pill)] px-3 font-head font-bold outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      style={{ minHeight: 44, background, border: "2px solid var(--chrome-line)", color: "var(--text)" }}
    >
      {label}
    </button>
  );
}

export function AlliancePopover({
  seat, name, colour, allied, offeredToMe, offeredByMe, canPropose,
  onPropose, onAccept, onBreak, onClose,
}: AlliancePopoverProps) {
  const status = allied
    ? "Allied"
    : offeredToMe ? `${name} wants an alliance` : offeredByMe ? "Offer sent" : "Not allied";

  return (
    <div
      data-testid={`alliance-popover-${seat}`}
      role="dialog"
      aria-label={`Alliance with ${name}`}
      className="pointer-events-auto absolute right-full top-1/2 mr-2 flex w-[220px] -translate-y-1/2 flex-col gap-2 p-3"
      style={{
        zIndex: "var(--z-modal)",
        background: "var(--chrome-800)",
        border: `2px solid ${playerVar(colour)}`,
        borderRadius: "var(--r-panel)",
        boxShadow: "var(--sh-panel)",
      }}
    >
      <div
        data-testid={`alliance-status-${seat}`}
        className="font-body"
        style={{ color: "var(--text-muted)", fontSize: 14 }}
      >
        {status}
      </div>

      {allied ? (
        <Action label="Break alliance" testId={`alliance-break-${seat}`} tone="danger" onClick={onBreak} />
      ) : (
        <>
          {offeredToMe ? (
            <Action label="Accept alliance" testId={`alliance-accept-${seat}`} tone="go" onClick={onAccept} />
          ) : null}
          {canPropose ? (
            <Action label="Propose alliance" testId={`alliance-propose-${seat}`} tone="go" onClick={onPropose} />
          ) : null}
        </>
      )}

      <Action label="Close" testId={`alliance-close-${seat}`} tone="neutral" onClick={onClose} />
    </div>
  );
}

export default AlliancePopover;
