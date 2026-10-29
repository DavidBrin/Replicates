// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE, type BoneTable } from "@/engine/acmd/bones";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { fx, toFloat } from "@/engine/fixed";
import type { FighterDef, Hitbox, MoveSlot } from "@/engine/types";
import { readBakeFromDisk } from "@/game/bakeNode";
import { FIGHTERS } from "../index";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";

/**
 * A limb-bone hitbox goes where our clip puts the limb, not where Ultimate's
 * animation would (Plan 4 risk 1). This ratchet catches a clip that puts an
 * adopted move's reach somewhere a player would call wrong: the furthest
 * forward edge of any live hitbox, baked, against the same move's legacy reach
 * (transcribed from the same published data, D17). A move off by more than
 * 3 units or 30% is listed in `reach.allow.json` with both numbers; a new one
 * fails until a human looks at it, fixes the clip, or allows it:
 *
 *   UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts
 */

const FILE = join(process.cwd(), "src", "fighters", "acmd", "reach.allow.json");
const bake = readBakeFromDisk();

/** How far forward a box reaches: its further end (a capsule's far end counts, DISPATCH-NOTES 13.7) plus its radius. */
function forwardEdge(h: Pick<Hitbox, "x" | "x2" | "radius">): number {
  return Math.max(h.x, h.x2 ?? h.x) + h.radius;
}

function reach(def: FighterDef, slot: MoveSlot, bones: BoneTable): number {
  const script = gameScriptFor(def, slot);
  const move = def.moves[slot];
  if (script === null || move === undefined) return 0;
  let best = -Infinity;
  for (let g = 1; g <= move.totalFrames; g++) {
    const st = runScript(script, g);
    if (st.attacks.length === 0) continue;
    for (const h of scriptHitboxes(st, def.id, script.motion, g, bones)) best = Math.max(best, forwardEdge(h));
  }
  return best === -Infinity ? 0 : best;
}

function offenders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const legacy of FIGHTERS) {
    const game = withLimbScripts(legacy, bake.bones);
    for (const slot of LIMB_SCRIPT_SLOTS[legacy.id] ?? []) {
      const before = reach(legacy, slot, LEGACY_BONE_TABLE);
      const after = reach(game, slot, bake.bones);
      if (Math.abs(after - before) > Math.max(fx(3), Math.abs(before) * 0.3)) {
        out[`${legacy.id} ${slot}`] = `legacy ${toFloat(before).toFixed(1)} / baked ${toFloat(after).toFixed(1)}`;
      }
    }
  }
  return out;
}

describe("a box's forward edge", () => {
  it("is its further end plus its radius: a capsule's far end counts, whichever end is written first", () => {
    expect(forwardEdge({ x: fx(2), radius: fx(1) })).toBe(fx(3));
    expect(forwardEdge({ x: fx(2), x2: fx(9), radius: fx(1) })).toBe(fx(10));
    expect(forwardEdge({ x: fx(9), x2: fx(2), radius: fx(1) })).toBe(fx(10));
  });
});

describe("adopted moves reach about as far as they did (Plan 4)", () => {
  const now = offenders();
  if (process.env.UPDATE_REACH === "1") {
    it("writes reach.allow.json", () => {
      writeFileSync(FILE, JSON.stringify(now, null, 2) + "\n");
    });
    return;
  }
  it("differ only where the allowlist says, and by how much", () => {
    expect(now).toEqual(JSON.parse(readFileSync(FILE, "utf8")));
  });
});
