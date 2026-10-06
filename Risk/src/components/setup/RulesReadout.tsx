"use client";

/**
 * The rules readout of SPEC §7 (`/new/rules`): three centred
 * `**Label:** value` lines, labels bold white, values `#CBD6DB` at 26 px,
 * 40 px apart — **no boxes**.
 *
 * The six entries are the SPEC's, verbatim, and every value is read live off
 * the `Rules` the store holds, so the readout and the modifier stack can
 * never disagree.
 */
import type { Rules } from "@/engine/types";
import { tierLabel } from "@/game/sessionConfig";

import { SETUP_TOKENS } from "../ui/tokens";

export interface RulesReadoutProps {
  readonly rules: Rules;
  readonly testId?: string;
  readonly className?: string;
}

interface Entry {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/** The six §7 entries, in the published order, as three lines of two. */
export function readoutLines(rules: Rules): readonly (readonly Entry[])[] {
  const entries: readonly Entry[] = [
    { key: "setup", label: "Setup", value: rules.manualPlacement ? "Manual" : "Auto" },
    { key: "turn-timer", label: "Turn Timer", value: rules.turnSeconds === null ? "Off" : `${rules.turnSeconds}s` },
    { key: "ai-difficulty", label: "AI Difficulty", value: tierLabel(rules.aiDifficulty) },
    { key: "card-bonus", label: "Card Bonus", value: rules.cardBonus === "fixed" ? "Fixed" : "Progressive" },
    { key: "dice-rolls", label: "Dice Rolls", value: rules.diceMode === "balancedBlitz" ? "Balanced Blitz" : "True Random" },
    { key: "alliances", label: "Alliances", value: rules.alliances ? "On" : "Off" },
  ];
  return [entries.slice(0, 2), entries.slice(2, 4), entries.slice(4, 6)];
}

export function RulesReadout({ rules, testId, className }: RulesReadoutProps) {
  return (
    <div data-testid={testId ?? "rules-readout"} className={className}>
      {readoutLines(rules).map((line, index) => (
        <div
          key={line[0]?.key ?? index}
          className="flex flex-wrap items-baseline justify-center gap-x-6"
          style={{ marginBottom: index === 2 ? 0 : 40 }}
        >
          {line.map((entry) => (
            <span
              key={entry.key}
              data-testid={`rules-readout-${entry.key}`}
              className="font-body whitespace-nowrap"
              style={{ fontSize: "clamp(16px, 2.2vw, 26px)", color: SETUP_TOKENS.readoutValue }}
            >
              <strong className="font-head font-bold" style={{ color: "var(--text)" }}>
                {entry.label}:
              </strong>
              {" "}
              {entry.value}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export default RulesReadout;
