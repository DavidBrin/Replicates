"use client";

/**
 * The Blitz / dice view (SPEC §7.2) — **a full-screen takeover, not a box**.
 *
 * All geometry is the measured 1600×900 space (see `stage.tsx`): attacker disc
 * (230, 200) r 150, defender (1400, 230), the win chance at y 42 / 92, the
 * three dice on a white burst y 540–840, the blocky steppers at (620, 775) and
 * (975, 775), and the Attack Limit slider on the track x 1215–1475, y 790.
 *
 * **The win chance is constant gold at every probability** (D47); the ramp is
 * the opt-in usability deviation and both come from `winChanceColour`.
 */

import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Pill } from "@/components/ui/Pill";
import type { PlayerColour } from "@/engine/types";
import { playerVar, winChanceColour } from "@/render/palette";

import { DiceCube } from "./DiceCube";
import { at, atTopLeft, outlined, Stage } from "./stage";

/** `"blitz"` runs the battle to a conclusion; 1/2/3 throws that many dice. */
export type DiceChoice = "blitz" | 1 | 2 | 3;

export interface BlitzCombatant {
  readonly name: string;
  readonly colour: PlayerColour;
  readonly troops: number;
  readonly you: boolean;
  readonly bot: boolean;
}

export interface BlitzViewProps {
  readonly attacker: BlitzCombatant;
  readonly defender: BlitzCombatant;
  /** 0..1. Rendered as a whole percentage. */
  readonly winChance: number;
  /** `Settings.winChanceRamp`: false (the default) keeps the readout gold. */
  readonly ramp: boolean;
  readonly dice: DiceChoice;
  /** The most dice the attacker may throw, from their committed troops. */
  readonly maxDice: 1 | 2 | 3;
  readonly onDice: (next: DiceChoice) => void;
  /** The limiter's `stopUntil`: stop with this many troops left. `null` = none. */
  readonly attackLimit: number | null;
  readonly onAttackLimit: (stopUntil: number) => void;
  readonly onBattle: () => void;
  readonly onCancel: () => void;
  /** The faces currently shown on the three cubes. */
  readonly faces?: readonly [number, number, number];
}

const TRACK_UNFILLED = "#8E1F2C"; // §7.2 Attack Limit, unfilled
const TRACK_FILLED = "#D9344A"; // §7.2 Attack Limit, filled
const STEPPER = "#C8233A"; // §7.2 blocky steppers

function cycle(choice: DiceChoice, maxDice: 1 | 2 | 3, step: 1 | -1): DiceChoice {
  const order: DiceChoice[] = ["blitz"];
  for (let n = 1; n <= maxDice; n += 1) order.push(n as 1 | 2 | 3);
  const i = order.indexOf(choice);
  const from = i === -1 ? 0 : i;
  return order[(from + step + order.length) % order.length] ?? "blitz";
}

function Combatant({ who, x, y, flip }: {
  readonly who: BlitzCombatant; readonly x: number; readonly y: number; readonly flip: boolean;
}) {
  // The flag chip sits at 7 o'clock on a 150 px disc (mirrored for the defender).
  const dx = (flip ? 1 : -1) * 75;
  return (
    <>
      <div style={at(x, y)}>
        <Avatar
          colour={who.colour}
          name={who.name}
          size={300}
          laurel={who.you}
          bot={who.bot}
          testId={flip ? "blitz-defender" : "blitz-attacker"}
        />
      </div>
      <div
        data-testid={flip ? "blitz-defender-chip" : "blitz-attacker-chip"}
        style={{
          ...at(x + dx, y + 130),
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: playerVar(who.colour),
          border: "4px solid var(--text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "var(--sh-chip)",
        }}
      >
        <span style={outlined(34)}>{who.troops}</span>
      </div>
    </>
  );
}

export function BlitzView({
  attacker, defender, winChance, ramp, dice, maxDice, onDice,
  attackLimit, onAttackLimit, onBattle, onCancel, faces = [5, 3, 6],
}: BlitzViewProps) {
  const percent = Math.round(winChance * 100);
  const stop = attackLimit ?? 0;
  const committed = Math.max(0, attacker.troops - stop);
  const committedPct = attacker.troops > 0
    ? Math.round((committed / attacker.troops) * 100)
    : 0;

  return (
    <Stage testId="blitz-view" label="Blitz" z="var(--z-modal)">
      <div style={{ ...at(800, 42), ...outlined(30, 700) }}>Blitz Win Chance&nbsp;&nbsp;?</div>
      <div
        data-testid="blitz-win-chance"
        data-percent={percent}
        data-colour={winChanceColour(winChance, ramp)}
        style={{
          ...at(800, 92),
          ...outlined(44),
          color: winChanceColour(winChance, ramp),
        }}
      >
        {percent}%
      </div>

      <Combatant who={attacker} x={230} y={200} flip={false} />
      <Combatant who={defender} x={1400} y={230} flip />

      {/* the white radial burst behind the dice, y 540–840 */}
      <div
        aria-hidden
        style={{
          ...at(800, 690),
          width: 620,
          height: 400,
          background: "radial-gradient(closest-side, rgba(255,255,255,.85), rgba(255,255,255,0) 72%)",
        }}
      />
      <div style={at(712, 630)}><DiceCube pips={faces[0]} rotate={-9} testId="blitz-die-0" /></div>
      <div style={at(905, 620)}><DiceCube pips={faces[1]} rotate={11} testId="blitz-die-1" /></div>
      <div style={at(805, 745)}><DiceCube pips={faces[2]} rotate={-3} testId="blitz-die-2" /></div>

      <button
        type="button"
        data-testid="blitz-dice-stepper-prev"
        aria-label="Fewer dice"
        onClick={() => onDice(cycle(dice, maxDice, -1))}
        style={{ ...at(620, 775), width: 60, height: 75, background: "transparent", border: "none",
          cursor: "pointer", color: STEPPER, display: "grid", placeItems: "center" }}
      >
        <svg width="60" height="75" viewBox="0 0 60 75" aria-hidden>
          <path d="M44 4 14 37.5 44 71 44 52 34 37.5 44 23Z" fill={STEPPER} />
        </svg>
      </button>
      <button
        type="button"
        data-testid="blitz-dice-stepper-next"
        aria-label="More dice"
        onClick={() => onDice(cycle(dice, maxDice, 1))}
        style={{ ...at(975, 775), width: 60, height: 75, background: "transparent", border: "none",
          cursor: "pointer", color: STEPPER, display: "grid", placeItems: "center" }}
      >
        <svg width="60" height="75" viewBox="0 0 60 75" aria-hidden>
          <path d="M16 4 46 37.5 16 71 16 52 26 37.5 16 23Z" fill={STEPPER} />
        </svg>
      </button>
      <div data-testid="blitz-dice-label" style={{ ...at(800, 855), ...outlined(34, 700) }}>
        {dice === "blitz" ? "Blitz" : String(dice)}
      </div>

      {/* bottom-right: the committed read-out over the Attack Limit slider */}
      <div style={{ ...at(1500, 672), ...outlined(40), textAlign: "right" }}>{committedPct}%</div>
      <div
        data-testid="blitz-committed"
        style={{ ...at(1500, 712), fontFamily: "var(--font-body), system-ui, sans-serif",
          fontSize: 24, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}
      >
        {committed}/{attacker.troops} Troops
      </div>

      <div style={{ ...atTopLeft(1215, 790 - 7), width: 260, height: 14 }}>
        <div
          aria-hidden
          style={{ position: "absolute", inset: 0, borderRadius: 999, background: TRACK_UNFILLED }}
        />
        <div
          aria-hidden
          data-testid="attack-limit-fill"
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 999,
            width: `${attacker.troops > 1 ? (stop / (attacker.troops - 1)) * 100 : 0}%`,
            background: TRACK_FILLED,
          }}
        />
        <input
          data-testid="attack-limit"
          type="range"
          min={0}
          max={Math.max(0, attacker.troops - 1)}
          step={1}
          value={stop}
          aria-label="Attack Limit"
          onChange={(e) => onAttackLimit(Number(e.currentTarget.value))}
          style={{ position: "absolute", left: 0, top: -22, width: "100%", height: 58, opacity: 0,
            cursor: "pointer", margin: 0 }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute", top: -17,
            left: `calc(${attacker.troops > 1 ? (stop / (attacker.troops - 1)) * 100 : 0}% - 24px)`,
            width: 48, height: 48, borderRadius: "50%", background: TRACK_FILLED,
            border: `3px solid ${TRACK_UNFILLED}`, display: "grid", placeItems: "center",
          }}
        >
          <Icon name="soldier" size={28} />
        </span>
      </div>
      <div style={{ ...at(1345, 852), fontFamily: "var(--font-head), system-ui, sans-serif",
        fontWeight: 700, fontSize: 20, color: "var(--text)", whiteSpace: "nowrap" }}>
        Attack Limit&nbsp;&nbsp;?
      </div>

      <div style={at(1500, 60)}>
        <IconButton chassis="circle" tone="danger" icon="cross" size={64} label="Cancel attack"
          onClick={onCancel} testId="blitz-cancel" />
      </div>
      {/* The commit control. The measured action-bar slot (x 680–918, y 822–870) is
          occupied by the `Blitz` label in this view, so the pill sits clear of every
          measured element, under the win chance. */}
      <div style={at(800, 430)}>
        <Pill variant="primary" size="hero" label="BATTLE" onClick={onBattle}
          testId="blitz-battle" />
      </div>
    </Stage>
  );
}

export default BlitzView;
