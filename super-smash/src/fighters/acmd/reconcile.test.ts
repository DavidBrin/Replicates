import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runScript } from "@/engine/acmd/interpreter";
import { toFloat } from "@/engine/fixed";
import { activeHitboxes } from "@/engine/hitbox";
import type { MoveDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "../index";
import { REFERENCE_SCRIPTS } from "./index";

/**
 * DECISIONS D17, kept honest: the roster's hand-authored moves against the
 * scripts they were transcribed from.
 *
 * For every move with both, four facts are compared — first active frame,
 * last active frame, the lowest-id hitbox's damage/angle/knockback on that
 * first frame, and first actionable frame (`CancelFrame`, which is the legacy
 * `totalFrames + 1`). Every disagreement is listed in `reconcile.allow.json`
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

function legacyFacts(move: MoveDef): Facts | null {
  let first = -1;
  let last = -1;
  for (let g = 1; g <= move.totalFrames + 1; g++) {
    if (activeHitboxes(move, g).length === 0) continue;
    if (first < 0) first = g;
    last = g;
  }
  if (first < 0) return null;
  const lead = activeHitboxes(move, first).sort((a, b) => a.id - b.id)[0];
  const kb = lead.setKnockback ? `fkb${fmt(lead.baseKnockback)}` : `bkb${fmt(lead.baseKnockback)}`;
  return {
    first,
    last,
    lead: lead.grabbing ? "grab" : `${fmt(lead.damage)}%/${fmt(lead.angle)}°/${kb}/kbg${fmt(lead.knockbackGrowth)}`,
    faf: move.totalFrames + 1,
  };
}

function referenceFacts(fighter: string, key: string): Facts | null {
  const ref = REFERENCE_SCRIPTS[fighter];
  const s = ref.scripts[key];
  let first = -1;
  let last = -1;
  for (let g = 1; g <= HORIZON; g++) {
    const st = runScript(s, g);
    if (st.attacks.length + st.catches.length === 0) continue;
    if (first < 0) first = g;
    last = g;
  }
  if (first < 0) return null;
  const a = runScript(s, first).attacks[0];
  const kb = a === undefined ? "" : a.fkb > 0 ? `fkb${fmt(a.fkb)}` : `bkb${fmt(a.bkb)}`;
  return {
    first,
    last,
    lead: a === undefined ? "grab" : `${fmt(a.damage)}%/${fmt(a.angle)}°/${kb}/kbg${fmt(a.kbg)}`,
    faf: ref.faf[key] ?? -1,
  };
}

function disagreements(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of FIGHTERS) {
    const ref = REFERENCE_SCRIPTS[def.id];
    for (const slot of Object.keys(def.moves) as MoveSlot[]) {
      const key = ref.slots[slot];
      const move = def.moves[slot];
      if (key === undefined || move === undefined) continue;
      const mine = legacyFacts(move);
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
