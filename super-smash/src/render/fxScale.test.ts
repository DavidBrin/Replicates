// @vitest-environment node
/**
 * Every move effect at SSBU size (Plan 6, Task 37; Plan 4 final review, Declined #9: the
 * effects "were authored against the 2D rig's proportions and scale to the model's head
 * height … eyeball each on an SSBU-sized body"). A numeric stand-in for the eyeballing: on
 * each frame a move's boxes are live, its painter's drawn box (a mock canvas, every
 * transform followed, at the model's own height) is held against those boxes, the game's
 * own (the limb-bone scripts, placed through the committed bake). An effect is where its
 * hitboxes are and about their size: its larger side a third to four times theirs, its
 * centre within its own size of theirs (UNVERIFIED, cosmetic: an effect may trail or flash
 * past its box). The Final Smashes are scenes, held by Task 17's pins.
 *
 * A ratchet, as `reach.allow.json` is: an effect out of band is listed in `EXPECTED`, with
 * what was measured and why it is right on the model, or fixed until it is in band; an
 * entry whose effect comes back in band is struck. A new one fails until a human looks
 * (Step 5's look).
 */
import { describe, expect, it } from "vitest";

import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { moveScriptFrame } from "@/engine/acmd/run";
import { toFloat } from "@/engine/fixed";
import type { MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { overlayAnchor } from "@/render3d/anchors";
import { fxFor } from "./chars";
import { paintedBox, runPainter } from "./testFixtures";

const bake = readBakeFromDisk();
const U = 8;
const FEET = { x: 400, y: 600 };
const EFFECT_MAX_RATIO = 4;
const EFFECT_MIN_RATIO = 1 / 3;
const SCENES: ReadonlySet<MoveSlot> = new Set(["finalSmash"]);

/** Effects out of band, by `"<fighter> <slot>"`: what was measured, and why it is right on the model (Step 5's look). */
const EXPECTED: Readonly<Record<string, string>> = {
  "mario upB": "0.20x, 5.2 off: the Star Coins are the hit effect, coin-sized puffs thrown from the box's front edge where a victim is struck (none on a whiff), not the body-wide box",
  "donkeyKong dashAttack": "0.82x, 16.3 off: the roll's dust, a trail left behind him along the floor while the box rolls ahead",
  "donkeyKong downB": "0.66x, 8.0 off: the ground wave leaves from under him and spreads both ways; the palms' box ahead is live only on its first two frames, while the ring is born",
  "link upB": "0.77x, 18.1 off: the spin's ring round his waist marks its plane; the boxes ride the blade round it, and the sword trail draws that sweep",
  "link upBAir": "0.69x, 19.4 off: upB's ring (the same painter, judged from upB's sheet); the blade's boxes, overhead included, are the sword trail's",
  "samus uthrow": "0.99x, 14.0 off: the shot into the fighter held 9 up; the script's fire box is 23 up on a `throw` joint the replica does not place (judged from the numbers and the grab's sheet)",
  "fox upB": "4.02x, 0.0 off: Fire Fox's launch flash (over 4x on one frame) and the exhaust trailing under him, over his body-sized box",
  "pikachu fsmash": "2.48x, 18.8 off: the discharge bursts at his cheeks; the script's later boxes run 21 to 29 ahead, past it",
  "pikachu fair": "0.64x, 8.9 off: the current wraps the head he drills forward with; the boxes sit 6 to 15 ahead of it",
  "pikachu dair": "0.62x, 11.2 off: the screw's current under his feet; the box rides the tail through its loop over him, which its trail draws",
  "pikachu downB": "5.91x, 0.0 off: Thunder's cloud and the bolt's column down to him, over the body-sized box the bolt makes when it lands",
  "pikachu fthrow": "0.48x, 9.5 off: the zaps are on Pikachu, where the current comes from; the throw's box is on the fighter held up in front of him (judged from the numbers and the grab's sheet)",
  "marth usmash": "0.22x, 12.1 off: the tipper flash, on the point alone; the move's boxes span the blade, and the ground sweep's on 13-14",
  "marth dair": "0.25x, 0.0 off: the tipper flash, on the point alone; the blade's other boxes are the sword trail's",
  "marth sideB": "0.28x, 0.0 off: the tipper flash, on the point of the thrust alone, not the whole blade",
};

/** Each of a fighter's effects out of band, by slot: its worst size ratio and its worst distance off its boxes' centre, units. */
function outliers(id: string): string[] {
  const def = withLimbScripts(FIGHTERS.find((f) => f.id === id)!, bake.bones);
  // The height a match hands its painters: the model's head top, standing (`renderer.ts`).
  const standing = { defId: id, action: "stand" as const, actionFrame: 0, move: null, port: 0, charge: 0, hitstun: 0, jumpsUsed: 0, fastFalling: false, vx: 0, vy: 0, shortHop: false, facing: 1 };
  const height = overlayAnchor(def, standing, 0, bake)!.headTop;
  const out: string[] = [];
  for (const slot of Object.keys(def.moves) as MoveSlot[]) {
    const paint = fxFor(def.id, slot);
    const move = def.moves[slot];
    if (paint === undefined || move === undefined || SCENES.has(slot)) continue;
    let worstRatio = 1;
    let worstOff = 0;
    for (let frame = 1; frame <= move.totalFrames; frame++) {
      const run = moveScriptFrame(def, { move: slot, actionFrame: frame - 1 });
      const boxes = run === null ? [] : scriptHitboxes(run.state, def.id, run.script.motion, run.gameFrame, bake.bones);
      if (boxes.length === 0) continue;
      const drawn = paintedBox(runPainter(paint, def, { x: FEET.x, y: FEET.y, u: U, height, frame, total: move.totalFrames, t: frame / move.totalFrames, f: { action: "attack", move: slot, actionFrame: frame - 1 } }));
      if (drawn === null) continue;
      // Both in world units, ahead of the feet and up from them.
      const hit = {
        minX: Math.min(...boxes.map((b) => toFloat(Math.min(b.x, b.x2 ?? b.x) - b.radius))),
        maxX: Math.max(...boxes.map((b) => toFloat(Math.max(b.x, b.x2 ?? b.x) + b.radius))),
        minY: Math.min(...boxes.map((b) => toFloat(Math.min(b.y, b.y2 ?? b.y) - b.radius))),
        maxY: Math.max(...boxes.map((b) => toFloat(Math.max(b.y, b.y2 ?? b.y) + b.radius))),
      };
      const fx = { minX: (drawn.minX - FEET.x) / U, maxX: (drawn.maxX - FEET.x) / U, minY: (FEET.y - drawn.maxY) / U, maxY: (FEET.y - drawn.minY) / U };
      const size = (b: typeof hit) => Math.max(b.maxX - b.minX, b.maxY - b.minY);
      const ratio = size(fx) / size(hit);
      if (Math.abs(Math.log(ratio)) > Math.abs(Math.log(worstRatio))) worstRatio = ratio;
      const apart = Math.hypot((fx.minX + fx.maxX - hit.minX - hit.maxX) / 2, (fx.minY + fx.maxY - hit.minY - hit.maxY) / 2);
      if (apart > size(fx)) worstOff = Math.max(worstOff, apart);
    }
    if (worstRatio > EFFECT_MAX_RATIO || worstRatio < EFFECT_MIN_RATIO || worstOff > 0) out.push(`${id} ${slot}: ${worstRatio.toFixed(2)}x, ${worstOff.toFixed(1)} off`);
  }
  return out;
}

describe("move effects at the model's size, on their own hitboxes (Plan 6, Task 37)", () => {
  it.each(FIGHTERS.map((f) => f.id))("%s's effects sit on their live hitboxes, a third to four times their size, or are listed with why", (id) => {
    const out = outliers(id);
    expect(out.filter((o) => EXPECTED[o.slice(0, o.indexOf(":"))] === undefined), "out of band and not listed").toEqual([]);
    const listed = Object.keys(EXPECTED).filter((k) => k.startsWith(`${id} `));
    expect(listed.filter((k) => !out.some((o) => o.startsWith(`${k}:`))), "listed but back in band: strike it").toEqual([]);
  });

  it("measures a painter it can see: Mario's forward smash, its fire on its hitbox", () => {
    // Not vacuous: the fire palm draws on its live frames, and is measured.
    const def = withLimbScripts(FIGHTERS.find((f) => f.id === "mario")!, bake.bones);
    expect(paintedBox(runPainter(fxFor("mario", "fsmash")!, def, { u: U, frame: 15, total: def.moves.fsmash!.totalFrames, f: { action: "attack", move: "fsmash" } }))).not.toBeNull();
  });
});
