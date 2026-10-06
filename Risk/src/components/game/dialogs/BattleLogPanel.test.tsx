import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { BattleLogEntry } from "@/game/session";
import { SEAT_NEUTRAL } from "@/engine/types";

import { BattleLogPanel, tallyBattles } from "./BattleLogPanel";

const SEATS = [
  { seat: 0, name: "Ada", colour: "red" as const },
  { seat: 1, name: "Grace", colour: "green" as const },
];

const ENTRIES: readonly BattleLogEntry[] = [
  { id: 1, round: 1, attacker: 0, defender: 1, from: 0, to: 3, attackerLosses: 2, defenderLosses: 3, conquered: true },
  { id: 2, round: 2, attacker: 1, defender: 0, from: 4, to: 3, attackerLosses: 1, defenderLosses: 0, conquered: false },
  { id: 3, round: 2, attacker: 1, defender: SEAT_NEUTRAL, from: 4, to: 5, attackerLosses: 0, defenderLosses: 1, conquered: true },
];

describe("BattleLogPanel (D108)", () => {
  it("tallies killed, lost, taken and ceded per seat, attacking or defending", () => {
    expect(tallyBattles(ENTRIES, [0, 1])).toEqual([
      { seat: 0, lost: 2, killed: 4, taken: 1, ceded: 0 },
      { seat: 1, lost: 4, killed: 3, taken: 1, ceded: 1 },
    ]);
  });

  it("lists every battle with who, where, the losses and the capture", () => {
    render(<BattleLogPanel entries={ENTRIES} seats={SEATS} territoryName={(t) => `T${t}`} onClose={() => {}} />);
    const row = screen.getByTestId("battle-log-row-1");
    expect(row).toHaveTextContent("Ada");
    expect(row).toHaveTextContent("T0 →");
    expect(row).toHaveTextContent("T3");
    expect(row).toHaveTextContent("Grace");
    expect(row).toHaveTextContent("attacker lost 2, defender lost 3");
    expect(row).toHaveAttribute("data-conquered", "true");
    expect(screen.getByTestId("battle-log-row-2")).toHaveAttribute("data-conquered", "false");
    // The neutral holding is named even though it has no seat row.
    expect(screen.getByTestId("battle-log-row-3")).toHaveTextContent("Neutral");
  });

  it("says so when nothing has been fought, and closes on the ✗", () => {
    const onClose = vi.fn();
    render(<BattleLogPanel entries={[]} seats={SEATS} territoryName={String} onClose={onClose} />);
    expect(screen.getByTestId("battle-log-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("battle-log-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
