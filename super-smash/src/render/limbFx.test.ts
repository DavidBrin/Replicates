/**
 * Move effects against the defs the game plays (Plan 4, Task 20 carries 4–6).
 *
 * From Task 20 the overlay draws its move effects with the game's fighters
 * (`GAME_SIM_CONTEXT.fighter`): limb-bone scripts on, their tables placed
 * through the bake (`withLimbScripts(def, bake.bones)`). Those tables differ from
 * the authored ones in two ways the painters must follow. The scripts number
 * Marth's tipper last, not first; and a box the script moves is one entry per
 * frame, so a painter that keyed on "the strongest entry" or faded each ended
 * entry saw one frame where the authored table had a window.
 */

import { describe, expect, it } from "vitest";

import type { FighterDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { createCamera } from "./camera";
import { fx as marthFx } from "./chars/marth/fx";
import { createMockContext, type MockContext } from "./mockContext";
import { drawMoveFx } from "./specialFx";
import { makeFighter, makeStage } from "./testFixtures";

const bake = readBakeFromDisk();
const authored = (id: string) => FIGHTERS.find((f) => f.id === id)!;
const game = (id: string) => withLimbScripts(authored(id), bake.bones);
const cam = createCamera(makeStage());

/** Everything a move's effect paints on sim frame `frame` (`c.frame` is `actionFrame + 1`). */
function painted(def: FighterDef, slot: MoveSlot, frame: number, struckWith?: number | null): MockContext {
  const ctx = createMockContext();
  const f = makeFighter({ defId: def.id, action: "attack", move: slot, actionFrame: frame - 1 });
  const vfx = struckWith === undefined ? undefined : { lastHit: [struckWith === null ? null : { hitboxId: struckWith, frame: 0 }, null, null, null], frame: f.actionFrame };
  const r = drawMoveFx(ctx, def, f, cam, 14, 960, 700, vfx);
  for (const paint of r.over) paint();
  return ctx;
}

/** The tipper flash's size: the largest ring or glow it draws. */
const biggest = (ctx: MockContext) => Math.max(0, ...ctx.calls.filter((c) => c.method === "arc").map((c) => c.args[2] as number));
/** Tip stars painted: each is two closed shapes, the long star and its cross spike. */
const stars = (ctx: MockContext) => ctx.calls.filter((c) => c.method === "closePath").length / 2;

const marthLimb = (LIMB_SCRIPT_SLOTS.marth ?? []).filter((slot) => slot in marthFx);

describe("Marth's tipper on the game's defs (carry 4)", () => {
  it("has limb-bone moves to check, each with an effect", () => {
    expect(marthLimb.length).toBeGreaterThanOrEqual(9);
  });

  /**
   * All nine of his limb-bone scripts put the tip at the highest id (fair: #2
   * 11.5% against #0 and #1 at 8%), so a flash that took the lowest id, as
   * `bestHitbox` resolves overlaps, bloomed on a sourspot and stayed dark on a
   * real tipper. The tip is the box that deals the most.
   */
  it.each(marthLimb)("%s: blooms when the tipper lands, and stays dark when a sourspot does", (slot) => {
    const marth = game("marth");
    const boxes = marth.moves[slot]!.hitboxes.filter((h) => !h.grabbing);
    const strongest = Math.max(...boxes.map((h) => h.damage));
    const tip = boxes.find((h) => h.damage === strongest)!;
    const frame = tip.startFrame;
    const sour = boxes.find((h) => h.damage < strongest && h.startFrame <= frame && frame <= h.endFrame);
    expect(sour, `${slot}: a weaker box live with the tip on frame ${frame}`).toBeDefined();
    expect(biggest(painted(marth, slot, frame, tip.id)), `${slot}: a tipper hit`).toBeGreaterThan(biggest(painted(marth, slot, frame, null)));
    expect(biggest(painted(marth, slot, frame, sour!.id)), `${slot}: a sourspot hit`).toBe(0);
  });

  /**
   * Two boxes as strong as each other are both the tip: jab 1's #2 and #3 (5%,
   * frames 5–6) and up tilt's #3 and #5 (10%, frame 6). A hit by either is a
   * tipper, whichever of them the flash is drawn on.
   */
  it.each([
    ["jab1", 5],
    ["utilt", 6],
  ] as const)("%s: blooms for every box as strong as the tip, on frame %i", (slot, frame) => {
    const marth = game("marth");
    const live = marth.moves[slot]!.hitboxes.filter((h) => !h.grabbing && h.startFrame <= frame && frame <= h.endFrame);
    const strongest = Math.max(...live.map((h) => h.damage));
    const tips = [...new Set(live.filter((h) => h.damage === strongest).map((h) => h.id))];
    expect(tips.length, `${slot} f${frame}: equally strong boxes`).toBeGreaterThanOrEqual(2);
    const gleam = biggest(painted(marth, slot, frame, null));
    for (const id of tips) expect(biggest(painted(marth, slot, frame, id)), `${slot} f${frame}: a hit by #${id}`).toBeGreaterThan(gleam);
  });

  it("marks forward air's 11.5% box, the script's #2, as the tip", () => {
    const marth = game("marth");
    const fair = marth.moves.fair!.hitboxes;
    const tip = fair.find((h) => h.id === 2)!;
    expect(fair.every((h) => h.damage <= tip.damage)).toBe(true);
    expect(biggest(painted(marth, "fair", tip.startFrame, 2))).toBeGreaterThan(0);
    expect(biggest(painted(marth, "fair", tip.startFrame, 0))).toBe(0);
  });
});

describe("Marth's tip trail on the game's defs (carry 5)", () => {
  /**
   * Neutral air's second swing moves its tip every frame: seven entries of
   * #2, one per frame. Each fading over `TIP_TAIL` drew a trail of up to five
   * points; one point fades, the last, when the box stops. The authored table
   * (one entry for the window) is the reference: the same count every frame.
   */
  it("draws the tip once per frame on a moving box, exactly as on the authored window", () => {
    const frames = Array.from({ length: 22 }, (_, i) => 5 + i);
    const count = (def: FighterDef) => frames.map((frame) => stars(painted(def, "nair", frame, null)));
    const authoredCounts = count(authored("marth"));
    expect(authoredCounts.some((n) => n > 0)).toBe(true);
    expect(count(game("marth"))).toEqual(authoredCounts);
  });

  it("still fades the last position out after the box has gone", () => {
    const nair = game("marth").moves.nair!.hitboxes;
    const end = Math.max(...nair.map((h) => h.endFrame));
    expect(stars(painted(game("marth"), "nair", end + 1, null))).toBe(1);
    expect(stars(painted(game("marth"), "nair", end + 5, null))).toBe(0);
  });
});

describe("Donkey Kong's neutral air ring on the game's defs (carry 6)", () => {
  /**
   * The clean hit (12%) is frames 10–13. The script writes it as four boxes
   * per frame, 52 entries against the authored 2, and the first strongest entry
   * ends on frame 10: the ring began fading three frames early. On the game's
   * def it now paints exactly what the authored window paints, frame for frame.
   */
  /** What was drawn, comparable across two paints (a gradient stub is a fresh object each time). */
  const drawing = (ctx: MockContext) => JSON.stringify(ctx.calls);

  it("holds full strength through frame 13, then fades as the authored window does", () => {
    for (let frame = 6; frame <= 28; frame++) {
      expect(drawing(painted(game("donkeyKong"), "nair", frame)), `frame ${frame}`).toBe(drawing(painted(authored("donkeyKong"), "nair", frame)));
    }
    // Not vacuous: the ring is drawn, and dims after the clean window.
    expect(painted(game("donkeyKong"), "nair", 13).calls.length).toBeGreaterThan(0);
    expect(drawing(painted(game("donkeyKong"), "nair", 13))).not.toBe(drawing(painted(game("donkeyKong"), "nair", 14)));
  });
});
