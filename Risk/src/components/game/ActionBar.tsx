"use client";

/**
 * The bottom action bar (SPEC §7.1).
 *
 * Avatar disc, the phase label in letter-spaced caps, **three phase pips —
 * a progress bar, not tabs** (92×12, radius 6, gap 12), the measured 238×48
 * green primary pill, and the circular dice/mode button. Online only, a 4 px
 * turn-timer bar drains under the phase label (D69).
 */
import type { PlayerColour, Phase } from "@/engine/types";

import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";
import { Pill } from "@/components/ui/Pill";

import { TurnTimerBar } from "./TurnTimerBar";

/** The three phases the pip row tracks, in order. `CAPITAL` replaces the
 *  label in Capitals mode (§7.1); the pip row is unchanged. */
export const PIP_PHASES: readonly Phase[] = ["draft", "attack", "fortify"];

export interface ActionBarProps {
  readonly phase: Phase;
  readonly phaseLabel: string;
  readonly prompt: string;
  readonly seatName: string;
  readonly colour: PlayerColour;
  readonly you: boolean;
  readonly bot: boolean;
  /** The primary pill's label, already resolved (`End Attack Phase`, `End Turn`, …). */
  readonly primaryLabel: string;
  readonly primaryDisabled: boolean;
  readonly onPrimary: () => void;
  readonly onDice: () => void;
  /** Online only: the authority's `turn_deadline`, ISO 8601 (F42). */
  readonly turnDeadline?: string | null;
  readonly turnSeconds?: number | null;
  readonly now?: number;
}

export function ActionBar(props: ActionBarProps) {
  const index = PIP_PHASES.indexOf(props.phase);

  return (
    <div
      data-testid="action-bar"
      className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-end justify-center gap-4 pb-3"
      style={{ height: "16%", minHeight: 120, zIndex: "var(--z-hud)" }}
    >
      <Avatar colour={props.colour} name={props.seatName} size={92} laurel={props.you} bot={props.bot} />

      <div className="flex flex-col items-center gap-2">
        <p
          data-testid="action-prompt"
          className="on-board-text text-center"
          style={{ fontSize: 20, letterSpacing: ".02em" }}
        >
          {props.prompt}
        </p>

        <p
          data-testid="phase-label"
          className="on-board-text uppercase"
          style={{ fontSize: 28, letterSpacing: "3px" }}
        >
          {props.phaseLabel}
        </p>

        {props.turnDeadline ? (
          <TurnTimerBar
            deadline={props.turnDeadline}
            totalSeconds={props.turnSeconds ?? null}
            now={props.now}
          />
        ) : null}

        {/* Three pips: a progress bar, not tabs. */}
        <div data-testid="phase-pips" className="flex" style={{ gap: 12 }}>
          {PIP_PHASES.map((phase, i) => (
            <span
              key={phase}
              data-testid={`phase-pip-${phase}`}
              data-filled={i <= index && index >= 0 ? "true" : "false"}
              style={{
                width: 92, height: 12, borderRadius: 6,
                background: i <= index && index >= 0 ? "#FFFFFF" : "#6B7378",
                transition: "background 220ms ease-out",
              }}
            />
          ))}
        </div>

        <Pill
          variant={props.primaryDisabled ? "disabled" : "primary"}
          label={props.primaryLabel}
          onClick={props.onPrimary}
          testId="primary-action"
          disabled={props.primaryDisabled}
        />
      </div>

      <IconButton
        chassis="circle"
        icon="dice-cup"
        size={116}
        label="Dice settings"
        onClick={props.onDice}
        testId="dice-button"
      />
    </div>
  );
}

/**
 * The primary pill's label (§7.1). `Opponent's Turn` and `No Matching Cards`
 * are the two disabled states the evidence shows.
 */
export function primaryLabelFor(options: {
  phase: Phase;
  yourTurn: boolean;
  botPlaying: boolean;
  mustTrade: boolean;
  tradeValue: number;
  canTrade: boolean;
  troopsToPlace: number;
  pendingMoveIn: boolean;
}): { label: string; disabled: boolean } {
  if (!options.yourTurn || options.botPlaying) return { label: "Opponent's Turn", disabled: true };
  if (options.pendingMoveIn) return { label: "Move Troops", disabled: false };
  if (options.mustTrade) {
    return options.canTrade
      ? { label: `Trade In Now +${options.tradeValue}`, disabled: false }
      : { label: "No Matching Cards", disabled: true };
  }
  if (options.phase === "draft") {
    return { label: "End Draft Phase", disabled: options.troopsToPlace > 0 };
  }
  if (options.phase === "attack") return { label: "End Attack Phase", disabled: false };
  if (options.phase === "fortify") return { label: "End Turn", disabled: false };
  if (options.phase === "claim") return { label: "Place Army", disabled: true };
  return { label: "End Turn", disabled: true };
}

/** `DRAFT` / `ATTACK` / `FORTIFY`, and `CAPITAL` in Capitals mode (§7.1). */
export function phaseLabelFor(phase: Phase, capitals: boolean): string {
  if (phase === "claim") return capitals ? "CAPITAL" : "CLAIM";
  if (phase === "over") return "GAME OVER";
  return phase.toUpperCase();
}

export default ActionBar;
