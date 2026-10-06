"use client";

/**
 * The rules half of the `/new/rules` Modifiers panel (SPEC §7).
 *
 * Split out of `ModifiersPanel` so neither file sprawls: this one owns every
 * control that writes a `Rules` field the modifier stack cannot express as a
 * single on/off — the `% Domination` slider (50–90, default 70), the
 * `Max Rounds` stepper (preset 5, labelled `5-Rounds Rumble`), `Turn Timer`
 * (60/90/120/180/300, **online only**, default 90), `Round Delay`, and the
 * `Card Bonus` / `Dice Rolls` / `Alliances` / `AI Difficulty` choices.
 *
 * Between the two files **every toggle in the `Rules` interface is
 * reachable**, which is the acceptance condition §7 states for this screen.
 */
import type { ReactNode } from "react";
import clsx from "clsx";

import type { BotTier, Rules } from "@/engine/types";
import { TURN_SECONDS } from "@/engine/types";
import { BOT_TIERS, tierLabel } from "@/game/sessionConfig";

export interface RulesControlsProps {
  readonly rules: Rules;
  readonly onChange: (patch: Partial<Rules>) => void;
  /** The turn timer exists online only (R79). */
  readonly online: boolean;
}

const ROUND_DELAYS = [0, 600, 1200, 2400] as const;

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="font-head font-bold" style={{ color: "var(--text)", fontSize: "clamp(14px,1.8vw,20px)" }}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Choice<T extends string | number>({
  name, options, value, onPick,
}: {
  readonly name: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onPick: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`rules-${name}-${option.value}`}
            data-active={active ? "true" : "false"}
            onClick={() => onPick(option.value)}
            className={clsx(
              "rounded-[var(--r-pill)] px-3 font-body outline-none focus-visible:ring-2 focus-visible:ring-white/80",
            )}
            style={{
              minHeight: 44,
              background: active ? "var(--cyan)" : "var(--chrome-900)",
              border: `2px solid ${active ? "var(--cyan)" : "var(--chrome-line)"}`,
              color: "var(--text)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function RulesControls({ rules, onChange, online }: RulesControlsProps) {
  const maxRounds = rules.maxRounds;

  return (
    <div data-testid="rules-controls" className="flex flex-col divide-y" style={{ borderColor: "var(--chrome-line)" }}>
      <Row label="Win Condition">
        <Choice
          name="win"
          value={rules.winCondition}
          onPick={(winCondition) => onChange({ winCondition })}
          options={[
            { value: "world", label: "World Domination" },
            { value: "percentage", label: "Percentage" },
            { value: "capitals", label: "Capitals" },
          ]}
        />
      </Row>

      <Row label="% Domination">
        <input
          type="range"
          data-testid="rules-domination"
          aria-label="% Domination"
          min={50}
          max={90}
          step={5}
          value={Math.round(rules.dominationThreshold * 100)}
          onChange={(event) => onChange({ dominationThreshold: Number(event.target.value) / 100 })}
          style={{ width: 180, height: 44, accentColor: "var(--danger)" }}
        />
        <span data-testid="rules-domination-value" className="font-head font-bold" style={{ color: "var(--text)" }}>
          {Math.round(rules.dominationThreshold * 100)}%
        </span>
      </Row>

      <Row label="Max Rounds">
        <button
          type="button"
          data-testid="rules-max-rounds-down"
          aria-label="Fewer rounds"
          onClick={() => onChange({ maxRounds: maxRounds === null ? null : maxRounds <= 5 ? null : maxRounds - 5 })}
          className="rounded-[10px] font-head font-bold outline-none"
          style={{ width: 44, height: 44, background: "var(--chrome-900)", border: "2px solid var(--chrome-line)", color: "var(--text)" }}
        >
          −
        </button>
        <span data-testid="rules-max-rounds-value" className="min-w-[160px] text-center font-head font-bold" style={{ color: "var(--text)" }}>
          {maxRounds === null ? "Off" : maxRounds === 5 ? "5-Rounds Rumble" : `${maxRounds} rounds`}
        </span>
        <button
          type="button"
          data-testid="rules-max-rounds-up"
          aria-label="More rounds"
          onClick={() => onChange({ maxRounds: maxRounds === null ? 5 : Math.min(60, maxRounds + 5) })}
          className="rounded-[10px] font-head font-bold outline-none"
          style={{ width: 44, height: 44, background: "var(--chrome-900)", border: "2px solid var(--chrome-line)", color: "var(--text)" }}
        >
          +
        </button>
      </Row>

      <Row label="Turn Timer">
        {online ? (
          <Choice
            name="turn-timer"
            value={rules.turnSeconds ?? 90}
            onPick={(turnSeconds) => onChange({ turnSeconds })}
            options={TURN_SECONDS.map((s) => ({ value: s as number, label: `${s}s` }))}
          />
        ) : (
          <span data-testid="rules-turn-timer-offline" className="font-body" style={{ color: "var(--text-dim)" }}>
            Online only
          </span>
        )}
      </Row>

      <Row label="Round Delay">
        <Choice
          name="round-delay"
          value={rules.roundDelayMs}
          onPick={(roundDelayMs) => onChange({ roundDelayMs })}
          options={ROUND_DELAYS.map((ms) => ({ value: ms, label: ms === 0 ? "None" : `${ms / 1000}s` }))}
        />
      </Row>

      <Row label="Card Bonus">
        <Choice
          name="card-bonus"
          value={rules.cardBonus}
          onPick={(cardBonus) => onChange({ cardBonus })}
          options={[{ value: "fixed", label: "Fixed" }, { value: "progressive", label: "Progressive" }]}
        />
      </Row>

      <Row label="Dice Rolls">
        <Choice
          name="dice-mode"
          value={rules.diceMode}
          onPick={(diceMode) => onChange({ diceMode })}
          options={[
            { value: "balancedBlitz", label: "Balanced Blitz" },
            { value: "trueRandom", label: "True Random" },
          ]}
        />
      </Row>

      <Row label="Portals">
        <Choice
          name="portals"
          value={rules.portals}
          onPick={(portals) => onChange({ portals })}
          options={[
            { value: "off", label: "Off" },
            { value: "stable", label: "Stable" },
            { value: "unstable", label: "Unstable" },
          ]}
        />
      </Row>

      <Row label="Alliances">
        <Choice
          name="alliances"
          value={rules.alliances ? "on" : "off"}
          onPick={(v) => onChange({ alliances: v === "on" })}
          options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
        />
      </Row>

      <Row label="Capital Draft Bonus">
        <Choice
          name="capital-draft-bonus"
          value={rules.capitalDraftBonus ? "on" : "off"}
          onPick={(v) => onChange({ capitalDraftBonus: v === "on" })}
          options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
        />
      </Row>

      <Row label="AI Difficulty">
        <Choice
          name="ai-difficulty"
          value={rules.aiDifficulty}
          onPick={(aiDifficulty) => onChange({ aiDifficulty: aiDifficulty as BotTier })}
          options={BOT_TIERS.map((tier) => ({ value: tier, label: tierLabel(tier) }))}
        />
      </Row>
    </div>
  );
}

export default RulesControls;
