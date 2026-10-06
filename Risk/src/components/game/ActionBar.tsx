"use client";

/**
 * The bottom action bar (SPEC §7.1).
 *
 * The draft counter (D112) where the original's avatar disc sat — the troops
 * still to deploy, draft phase only, nothing in any other phase — the phase
 * label in letter-spaced caps, **three phase pips — a progress bar, not
 * tabs** (92×12, radius 6, gap 12), the measured 238×48 green primary pill,
 * and the circular dice button, which opens the Battle Log (D108). Online
 * only, a 4 px turn-timer bar drains under the phase label (D69).
 */
import type { PlayerColour, Phase } from "@/engine/types";

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
  /** Opens the Battle Log (D108). */
  readonly onDice: () => void;
  /** Troops still to deploy, shown in the draft phase only; `null` hides the counter (D112). */
  readonly draftLeft?: number | null;
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
      // The band spans the full width, so it must not eat clicks: only its
      // own controls are interactive. Without this the bottom-left stack —
      // Stats, Cards and Emote — sits underneath an invisible sheet.
      className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center gap-4 pb-3"
      // `--action-bar-h` is a token because the bottom-left icon stack has to
      // lift itself clear of this band at phone width (§8.9, globals.css).
      style={{ height: "var(--action-bar-h)", zIndex: "var(--z-hud)" }}
    >
      {props.draftLeft !== null && props.draftLeft !== undefined ? (
        <DraftCounter left={props.draftLeft} colour={props.colour} />
      ) : (
        // The counter's footprint, so the pill stays centred when it is gone.
        <div aria-hidden style={{ width: 92, height: 92 }} />
      )}

      {/*
        * The column itself takes no pointer events — only the pill does.
        *
        * The prompt, the phase label, the timer bar and the pip row are all
        * read-only chrome, and the column is **taller than the band it is
        * anchored in**: at 412 px a two-line prompt pushed its top up over
        * the bottom-left Stats / Cards / Chat stack, and `phase-pip-attack`
        * (or the prompt itself) intercepted every tap aimed at Chat. Marking
        * the column interactive was the bug; the pill carries the affordance.
        */}
      <div className="pointer-events-none flex flex-col items-center gap-2">
        <p
          data-testid="action-prompt"
          className="on-board-text text-center"
          style={{ fontSize: "var(--prompt-size)", letterSpacing: ".02em" }}
        >
          {props.prompt}
        </p>

        <p
          data-testid="phase-label"
          className="on-board-text uppercase"
          style={{ fontSize: "var(--phase-label-size)", letterSpacing: "3px" }}
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
        <div data-testid="phase-pips" className="flex" style={{ gap: "var(--pip-gap)" }}>
          {PIP_PHASES.map((phase, i) => (
            <span
              key={phase}
              data-testid={`phase-pip-${phase}`}
              data-filled={i <= index && index >= 0 ? "true" : "false"}
              style={{
                width: "var(--pip-w)", height: 12, borderRadius: 6,
                background: i <= index && index >= 0 ? "#FFFFFF" : "#6B7378",
                transition: "background 220ms ease-out",
              }}
            />
          ))}
        </div>

        <div className="pointer-events-auto">
          <Pill
            variant={props.primaryDisabled ? "disabled" : "primary"}
            label={props.primaryLabel}
            onClick={props.onPrimary}
            testId="primary-action"
            disabled={props.primaryDisabled}
          />
        </div>
      </div>

      <IconButton
        className="pointer-events-auto"
        chassis="circle"
        icon="dice-cup"
        size={116}
        label="Battle log"
        onClick={props.onDice}
        testId="dice-button"
      />
    </div>
  );
}

/** The troops left to deploy, in a 92 px disc of the acting seat's colour (D112). */
export function DraftCounter({ left, colour }: { left: number; colour: PlayerColour }) {
  return (
    <div
      data-testid="draft-counter"
      aria-label={`${left} troops left to deploy`}
      className="pointer-events-none flex flex-col items-center justify-center"
      style={{
        width: 92, height: 92, borderRadius: 46,
        background: `var(--p-${colour}-dark)`, border: `4px solid var(--p-${colour})`,
        boxShadow: "0 4px 0 rgba(0,0,0,.45)",
      }}
    >
      <span
        className="on-board-text"
        style={{ fontSize: 40, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}
      >
        {left}
      </span>
      <span className="on-board-text uppercase" style={{ fontSize: 11, letterSpacing: "2px", marginTop: 2 }}>
        to deploy
      </span>
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
