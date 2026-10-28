import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import type { AcmdScript } from "@/engine/acmd/types";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, MoveDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "../index";
import { REFERENCE_SCRIPTS } from "./index";

/**
 * DECISIONS D17, kept honest: the moves the roster actually runs against the
 * scripts they were transcribed from.
 *
 * For every move with both, four facts are compared — first active frame,
 * last active frame, the lowest-id hitbox's damage/angle/knockback (its bkb,
 * or its fkb and any bkb beside it, its growth and set weight) on that
 * first frame, and first actionable frame (`CancelFrame`, which is the
 * move's `totalFrames + 1`). "Runs" is `gameScriptFor`: the imported script
 * for a slot Plan 3 activated (`acmd/active.ts`), else the compiled legacy
 * move — which `legacy.test.ts` proves frame-identical to its table. Every disagreement is listed in `reconcile.allow.json`
 * with its value on each side. The list is a ratchet: it may shrink (Plan 3
 * adopts the scripts and deletes entries) but a new entry fails this test until
 * a human looks at it. Regenerate after a deliberate change with
 *
 *   UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
 *
 * Throws are not genuinely reconciled yet: the parser does not read
 * `ATTACK_ABS` (parse.ts), so about 51 of the entries, every throw, are its
 * blind spot rather than real disagreements. Plan 5 Task 7 lifts it.
 */

const ALLOW_FILE = join(process.cwd(), "src", "fighters", "acmd", "reconcile.allow.json");
const HORIZON = 300;

interface Facts {
  first: number;
  last: number;
  lead: string;
  faf: number;
}

const fmt = (n: number): string => String(Math.round(toFloat(n) * 1000) / 1000);

/** The facts of a script, run until `horizon`. */
function scriptFacts(s: AcmdScript, horizon: number): Omit<Facts, "faf"> | null {
  let first = -1;
  let last = -1;
  for (let g = 1; g <= horizon; g++) {
    const st = runScript(s, g);
    if (st.attacks.length + st.catches.length === 0) continue;
    if (first < 0) first = g;
    last = g;
  }
  if (first < 0) return null;
  const a = runScript(s, first).attacks[0];
  // A `bkb` beside an `fkb` and set weight are knockback too (Plan 3, Task 16b):
  // `+bkbN` after the fkb, `/sw` at the end.
  const kb = a === undefined ? "" : a.fkb > 0 ? `fkb${fmt(a.fkb)}${a.bkb !== 0 ? `+bkb${fmt(a.bkb)}` : ""}` : `bkb${fmt(a.bkb)}`;
  return {
    first,
    last,
    lead: a === undefined ? "grab" : `${fmt(a.damage)}%/${fmt(a.angle)}°/${kb}/kbg${fmt(a.kbg)}${a.setWeight ? "/sw" : ""}`,
  };
}

/** What the roster runs for `slot`: its script, until the move ends. */
function runningFacts(def: FighterDef, slot: MoveSlot, move: MoveDef): Facts | null {
  const script = gameScriptFor(def, slot);
  const facts = script === null ? null : scriptFacts(script, move.totalFrames + 1);
  return facts === null ? null : { ...facts, faf: move.totalFrames + 1 };
}

function referenceFacts(fighter: string, key: string): Facts | null {
  const ref = REFERENCE_SCRIPTS[fighter];
  const facts = scriptFacts(ref.scripts[key], HORIZON);
  return facts === null ? null : { ...facts, faf: ref.faf[key] ?? -1 };
}

function disagreements(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of FIGHTERS) {
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
        continue;
      }
      for (const k of ["first", "last", "lead", "faf"] as const) {
        if (k === "faf" && theirs.faf < 0) continue;
        if (mine[k] !== theirs[k]) out[`${def.id} ${slot} ${k}`] = `legacy ${mine[k]} / ${key} ${theirs[k]}`;
      }
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
