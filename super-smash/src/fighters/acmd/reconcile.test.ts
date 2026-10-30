import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import type { AcmdScript } from "@/engine/acmd/types";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, MoveDef, MoveSlot } from "@/engine/types";
import { readBakeFromDisk } from "@/game/bakeNode";
import { FIGHTERS } from "../index";
import { REFERENCE_SCRIPTS } from "./index";
import { liftScript } from "./lift";
import { withLimbScripts } from "./limb";

/**
 * DECISIONS D17, kept honest: the moves the roster actually runs against the
 * scripts they were transcribed from.
 *
 * For every move with both, four facts are compared — first active frame,
 * last active frame, the lowest-id hitbox's damage/angle/knockback (its bkb,
 * or its fkb and any bkb beside it, its growth and set weight) on that
 * first frame, and first actionable frame (`CancelFrame`, which is the
 * move's `totalFrames + 1`). A throw's launch counts as a hit (ruling P5-R9):
 * the frame its `ATK_HIT_ABS` fires is active, and on a first frame with no
 * box live its `ATTACK_ABS` is the lead. The first actionable frame is
 * compared whenever both sides give one, whether or not either has a hit.
 * "Runs" is `gameScriptFor`: the imported script
 * for a slot Plan 3 activated (`acmd/active.ts`), else the compiled legacy
 * move — which `legacy.test.ts` proves frame-identical to its table — as the
 * game plays it: with Plan 4's limb-bone scripts on (`limb.ts`). Every disagreement is listed in `reconcile.allow.json`
 * with its value on each side. The list is a ratchet: it may shrink (Plans 3
 * and 4 adopt the scripts and delete entries) but a new entry fails this test until
 * a human looks at it. Regenerate after a deliberate change with
 *
 *   UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
 *
 * Throws are reconciled since Plan 5 Task 7: the scripts the game runs carry
 * their `ATTACK_ABS` lifted (`lift.ts`), and the reference scripts are lifted
 * here the same way. The throw and pummel entries went 60 → 10, the legacy
 * throws whose frames or numbers really differ (Donkey Kong's cargo throws,
 * Kirby's up throw); comparing every first actionable frame added 5 moves with
 * no hit on either side (105 → 60 in all).
 */

const ALLOW_FILE = join(process.cwd(), "src", "fighters", "acmd", "reconcile.allow.json");
const HORIZON = 300;

interface Facts {
  first: number;
  last: number;
  lead: string;
}

const fmt = (n: number): string => String(Math.round(toFloat(n) * 1000) / 1000);

/**
 * A hit's damage/angle/knockback: a `bkb` beside an `fkb` and set weight are
 * knockback too (Plan 3, Task 16b): `+bkbN` after the fkb, `/sw` at the end.
 */
function leadOf(a: { damage: number; angle: number; fkb: number; bkb: number; kbg: number; setWeight?: boolean }): string {
  const kb = a.fkb > 0 ? `fkb${fmt(a.fkb)}${a.bkb !== 0 ? `+bkb${fmt(a.bkb)}` : ""}` : `bkb${fmt(a.bkb)}`;
  return `${fmt(a.damage)}%/${fmt(a.angle)}°/${kb}/kbg${fmt(a.kbg)}${a.setWeight === true ? "/sw" : ""}`;
}

/** The facts of a script, run until `horizon`; a throw's `ATK_HIT_ABS` frame is active. */
function scriptFacts(s: AcmdScript, horizon: number): Facts | null {
  let first = -1;
  let last = -1;
  for (let g = 1; g <= horizon; g++) {
    const st = runScript(s, g);
    const lands = st.throwAbs !== null && st.fired.some((c) => c.op === "hitAbs");
    if (st.attacks.length + st.catches.length === 0 && !lands) continue;
    if (first < 0) first = g;
    last = g;
  }
  if (first < 0) return null;
  const at = runScript(s, first);
  const a = at.attacks[0];
  const lead = a !== undefined ? leadOf(a) : at.catches.length > 0 || at.throwAbs === null ? "grab" : leadOf(at.throwAbs);
  return { first, last, lead };
}

/** What the roster runs for `slot`: its script, until the move ends. */
function runningFacts(def: FighterDef, slot: MoveSlot, move: MoveDef): Facts | null {
  const script = gameScriptFor(def, slot);
  return script === null ? null : scriptFacts(script, move.totalFrames + 1);
}

/** The reference script's facts, its throw commands lifted as the game's are. */
function referenceFacts(fighter: string, key: string): Facts | null {
  return scriptFacts(liftScript(REFERENCE_SCRIPTS[fighter].scripts[key]), HORIZON);
}

function disagreements(): Record<string, string> {
  const out: Record<string, string> = {};
  // The game's fighters: Plan 3's root-bone scripts and Plan 4's limb-bone ones,
  // placed through the bake as the game places them (ruling R1(a)).
  const bones = readBakeFromDisk().bones;
  for (const def of FIGHTERS.map((d) => withLimbScripts(d, bones))) {
    const ref = REFERENCE_SCRIPTS[def.id];
    for (const slot of Object.keys(def.moves) as MoveSlot[]) {
      const key = ref.slots[slot];
      const move = def.moves[slot];
      if (key === undefined || move === undefined) continue;
      const mine = runningFacts(def, slot, move);
      const theirs = referenceFacts(def.id, key);
      if (mine === null || theirs === null) {
        if (mine !== theirs) {
          out[`${def.id} ${slot} hitboxes`] = `legacy ${mine === null ? "none" : "some"} / ${key} ${theirs === null ? "none" : "some"}`;
        }
      } else {
        for (const k of ["first", "last", "lead"] as const) {
          if (mine[k] !== theirs[k]) out[`${def.id} ${slot} ${k}`] = `legacy ${mine[k]} / ${key} ${theirs[k]}`;
        }
      }
      // Whenever both sides give one (ruling P5-R9), hits or none.
      const faf = ref.faf[key];
      if (faf !== undefined && move.totalFrames + 1 !== faf) out[`${def.id} ${slot} faf`] = `legacy ${move.totalFrames + 1} / ${key} ${faf}`;
    }
  }
  return out;
}

describe("legacy moves against their imported scripts (D17)", () => {
  const now = disagreements();

  if (process.env.UPDATE_RECONCILE === "1") {
    it("writes the allowlist", () => {
      writeFileSync(ALLOW_FILE, JSON.stringify(now, null, 2) + "\n");
      expect(Object.keys(now).length).toBeGreaterThanOrEqual(0);
    });
    return;
  }

  it("disagree only where the allowlist says they do, and say how", () => {
    const allowed = JSON.parse(readFileSync(ALLOW_FILE, "utf8")) as Record<string, string>;
    expect(now).toEqual(allowed);
  });
});
