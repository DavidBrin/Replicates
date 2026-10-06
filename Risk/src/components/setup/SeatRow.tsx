"use client";

/**
 * One seat row of the `/new/rules` Modifiers panel (SPEC §7): the human/bot
 * toggle, the name field, the colour swatch picker and — only when the seat
 * is a bot — the `AI Difficulty` select.
 *
 * A colour another seat already holds is offered but disabled, so two seats
 * can never share one `PlayerColour`.
 */
import type { BotTier, PlayerColour, SeatConfig } from "@/engine/types";
import { BOT_TIERS, SEAT_COLOURS, tierLabel } from "@/game/sessionConfig";

import { Avatar } from "../ui/Avatar";
import { SegmentedToggle } from "../ui/SegmentedToggle";

export interface SeatRowProps {
  readonly index: number;
  readonly seat: SeatConfig;
  /** Colours held by the *other* seats. */
  readonly taken: readonly PlayerColour[];
  readonly onChange: (patch: Partial<SeatConfig>) => void;
  readonly onRemove?: () => void;
  readonly canRemove?: boolean;
}

export function SeatRow({ index, seat, taken, onChange, onRemove, canRemove = false }: SeatRowProps) {
  return (
    <div
      data-testid={`seat-row-${index}`}
      data-kind={seat.kind}
      data-colour={seat.colour}
      className="flex flex-wrap items-center gap-3 p-2"
      style={{
        background: "var(--chrome-700)",
        border: "2px solid var(--chrome-line)",
        borderRadius: "var(--r-panel)",
      }}
    >
      <Avatar
        name={seat.name}
        colour={seat.colour}
        size={48}
        bot={seat.kind === "bot"}
        testId={`seat-avatar-${index}`}
      />

      <SegmentedToggle
        testId={`seat-kind-${index}`}
        ariaLabel={`Seat ${index + 1} kind`}
        width={160}
        height={44}
        value={seat.kind}
        options={[{ value: "human", label: "Human" }, { value: "bot", label: "Bot" }]}
        onChange={(kind) => onChange({ kind })}
      />

      <input
        data-testid={`seat-name-${index}`}
        aria-label={`Seat ${index + 1} name`}
        value={seat.name}
        maxLength={20}
        onChange={(event) => onChange({ name: event.target.value })}
        className="min-w-[120px] flex-1 rounded-[10px] px-2 font-body outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        style={{
          height: 44,
          background: "var(--chrome-900)",
          border: "2px solid var(--chrome-line)",
          color: "var(--text)",
        }}
      />

      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Seat ${index + 1} colour`}>
        {SEAT_COLOURS.map((colour) => {
          const used = colour !== seat.colour && taken.includes(colour);
          return (
            <button
              key={colour}
              type="button"
              role="radio"
              aria-checked={colour === seat.colour}
              aria-label={colour}
              disabled={used}
              data-testid={`seat-colour-${index}-${colour}`}
              data-selected={colour === seat.colour ? "true" : "false"}
              onClick={() => onChange({ colour })}
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-25"
              style={{
                width: 28,
                height: 28,
                margin: 8, // keeps the touch target at 44 px without a 44 px dot
                background: `var(--p-${colour})`,
                border: `3px solid ${colour === seat.colour ? "var(--text)" : `var(--p-${colour}-wall)`}`,
              }}
            />
          );
        })}
      </div>

      {seat.kind === "bot" ? (
        <label className="flex items-center gap-2 font-body" style={{ color: "var(--text-muted)" }}>
          AI Difficulty
          <select
            data-testid={`seat-tier-${index}`}
            aria-label={`Seat ${index + 1} AI Difficulty`}
            value={seat.tier ?? "medium"}
            onChange={(event) => onChange({ tier: event.target.value as BotTier })}
            className="rounded-[10px] px-2 font-body outline-none"
            style={{
              height: 44,
              background: "var(--chrome-900)",
              border: "2px solid var(--chrome-line)",
              color: "var(--text)",
            }}
          >
            {BOT_TIERS.map((tier) => (
              <option key={tier} value={tier}>{tierLabel(tier)}</option>
            ))}
          </select>
        </label>
      ) : null}

      {onRemove ? (
        <button
          type="button"
          data-testid={`seat-remove-${index}`}
          aria-label={`Remove seat ${index + 1}`}
          disabled={!canRemove}
          onClick={onRemove}
          className="rounded-full font-head font-bold outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-30"
          style={{
            width: 44,
            height: 44,
            background: "var(--danger)",
            border: "2px solid var(--danger-deep)",
            color: "var(--text)",
          }}
        >
          −
        </button>
      ) : null}
    </div>
  );
}

export default SeatRow;
