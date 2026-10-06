"use client";

/**
 * The Battle Log (D108): every battle of the game, oldest first, with who
 * attacked whom, where, what each side lost and whether the territory fell —
 * and a per-seat tally above it. It replaces the dice-settings button, which
 * the replica had nothing to put behind.
 */

import type { BattleLogEntry } from "@/game/session";
import type { PlayerColour } from "@/engine/types";
import { SEAT_NEUTRAL } from "@/engine/types";
import { playerVar } from "@/render/palette";

import { IconButton } from "@/components/ui/IconButton";
import { Tray } from "@/components/ui/Tray";

import { at, atTopLeft, outlined, Stage } from "./stage";

export interface BattleLogSeat {
  readonly seat: number;
  readonly name: string;
  readonly colour: PlayerColour;
}

export interface BattleLogPanelProps {
  readonly entries: readonly BattleLogEntry[];
  readonly seats: readonly BattleLogSeat[];
  readonly territoryName: (t: number) => string;
  readonly onClose: () => void;
}

export interface SeatTally {
  readonly seat: number;
  readonly lost: number;      // troops this seat lost, attacking or defending
  readonly killed: number;    // troops this seat killed, attacking or defending
  readonly taken: number;     // territories captured
  readonly ceded: number;     // territories lost
}

/** The per-seat tally, exported so a test can pin the arithmetic. */
export function tallyBattles(entries: readonly BattleLogEntry[], seats: readonly number[]): readonly SeatTally[] {
  const rows = new Map<number, { lost: number; killed: number; taken: number; ceded: number }>();
  for (const seat of seats) rows.set(seat, { lost: 0, killed: 0, taken: 0, ceded: 0 });
  for (const e of entries) {
    const a = rows.get(e.attacker);
    const d = rows.get(e.defender);
    if (a) {
      a.lost += e.attackerLosses;
      a.killed += e.defenderLosses;
      if (e.conquered) a.taken += 1;
    }
    if (d) {
      d.lost += e.defenderLosses;
      d.killed += e.attackerLosses;
      if (e.conquered) d.ceded += 1;
    }
  }
  return seats.map((seat) => ({ seat, ...(rows.get(seat) as { lost: number; killed: number; taken: number; ceded: number }) }));
}

function Chip({ seat, seats }: { seat: number; seats: readonly BattleLogSeat[] }) {
  const row = seats.find((s) => s.seat === seat);
  const name = row ? row.name : seat === SEAT_NEUTRAL ? "Neutral" : `Seat ${seat}`;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
        fontFamily: "var(--font-head), system-ui", fontWeight: 700,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 14, height: 14, borderRadius: 7, display: "inline-block",
          background: row ? playerVar(row.colour) : "var(--land-neutral)",
          border: "2px solid var(--stroke-dark)",
        }}
      />
      {name}
    </span>
  );
}

export function BattleLogPanel({ entries, seats, territoryName, onClose }: BattleLogPanelProps) {
  const tally = tallyBattles(entries, seats.map((s) => s.seat));
  return (
    <Stage testId="battle-log" label="Battle Log" z="var(--z-modal)">
      <div style={{ ...at(800, 55), ...outlined(50, 900) }}>Battle Log</div>

      <div style={at(75, 512)}>
        <Tray testId="battle-log-close-tray">
          <IconButton chassis="circle" tone="danger" icon="cross" size={68}
            label="Close battle log" onClick={onClose} testId="battle-log-close" />
        </Tray>
      </div>

      {/* the per-seat tally */}
      <div
        data-testid="battle-log-tally"
        style={{
          ...atTopLeft(200, 110), width: 1200, display: "flex", flexWrap: "wrap", gap: 10,
          justifyContent: "center",
        }}
      >
        {tally.map((row) => (
          <div
            key={row.seat}
            data-testid={`battle-log-tally-${row.seat}`}
            style={{
              display: "flex", alignItems: "center", gap: 14, padding: "6px 14px", borderRadius: 10,
              background: "color-mix(in srgb, var(--chrome-800) 92%, transparent)",
              border: "2px solid var(--chrome-line)", color: "var(--text)", fontSize: 20,
              fontFamily: "var(--font-body), system-ui",
            }}
          >
            <Chip seat={row.seat} seats={seats} />
            <span>killed <b>{row.killed}</b></span>
            <span>lost <b>{row.lost}</b></span>
            <span>took <b>{row.taken}</b></span>
            <span>ceded <b>{row.ceded}</b></span>
          </div>
        ))}
      </div>

      {/* the log itself, newest at the bottom */}
      <div
        data-testid="battle-log-rows"
        style={{
          ...atTopLeft(200, 190), width: 1200, height: 640, overflowY: "auto",
          background: "color-mix(in srgb, var(--chrome-800) 92%, transparent)",
          border: "2px solid var(--chrome-line)", borderRadius: 12, padding: "8px 14px",
          display: "flex", flexDirection: "column", gap: 4, color: "var(--text)",
          fontFamily: "var(--font-body), system-ui", fontSize: 21,
        }}
      >
        {entries.length === 0 ? (
          <span data-testid="battle-log-empty" style={{ color: "var(--text-muted)", padding: 12 }}>
            No battles yet.
          </span>
        ) : null}
        {entries.map((e) => (
          <div
            key={e.id}
            data-testid={`battle-log-row-${e.id}`}
            data-conquered={e.conquered ? "true" : "false"}
            style={{
              display: "grid", gridTemplateColumns: "56px 72px 1fr", alignItems: "center", gap: 10,
              padding: "4px 6px", borderBottom: "1px solid var(--chrome-line)",
            }}
          >
            <span style={{ color: "var(--text-muted)" }}>#{e.id}</span>
            <span style={{ color: "var(--text-muted)" }}>R{e.round}</span>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Chip seat={e.attacker} seats={seats} />
              <span>{territoryName(e.from)} →</span>
              <span>{territoryName(e.to)}</span>
              <Chip seat={e.defender} seats={seats} />
              <span>· attacker lost <b>{e.attackerLosses}</b>, defender lost <b>{e.defenderLosses}</b></span>
              {e.conquered ? (
                <span style={{ color: "var(--gold)", fontWeight: 700 }}>· captured</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </Stage>
  );
}

export default BattleLogPanel;
