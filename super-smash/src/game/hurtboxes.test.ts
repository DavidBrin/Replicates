import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_BAKE } from "@/engine/acmd/bakeTables";
import { bakedEcb, ECB_BODY_BONES, ECB_TOP_BONES, fighterHurtboxes, localHurtboxes, restEcb } from "@/engine/acmd/hurtboxes";
import { poseIndexOf } from "@/engine/acmd/poseClock";
import { fx, toFloat } from "@/engine/fixed";
import { hurtboxCapsule } from "@/engine/hitbox";
import { FIGHTERS } from "@/fighters";
import { makeFighter } from "@/render/testFixtures";
import { hurtBonesFor } from "@/render3d/skeletons/hurtBones";
import { readBakeFromDisk } from "./bakeNode";

const bake = readBakeFromDisk();
const mario = FIGHTERS.find((f) => f.id === "mario")!;
const top = (caps: readonly { y1: number; y2: number; r: number }[]) => Math.max(...caps.map((c) => Math.max(c.y1, c.y2) + c.r));
/** The capsules of `id` whose bones set the ECB's top: the body, not the arms (fix round 1). */
const bodyOf = <T>(id: string, caps: readonly T[]) => caps.filter((_, i) => ECB_TOP_BONES.has(bake.hurtboxes(id)![i].bone));

describe("per-bone hurtboxes from the bake (Plan 4)", () => {
  it("gives every fighter one capsule per baked hurt bone while standing", () => {
    for (const def of FIGHTERS) {
      const caps = localHurtboxes(def, makeFighter({ defId: def.id }), 0, bake);
      expect(caps, def.id).not.toBeNull();
      expect(caps!.length).toBe(bake.hurtboxes(def.id)!.length);
      expect(caps!.length).toBeGreaterThanOrEqual(7);
    }
  });

  it("lowers the hurtboxes when the fighter crouches", () => {
    const stand = localHurtboxes(mario, makeFighter({ action: "stand" }), 0, bake)!;
    const crouch = localHurtboxes(mario, makeFighter({ action: "crouch", actionFrame: 10 }), 0, bake)!;
    expect(top(crouch)).toBeLessThan(top(stand) - fx(1));
  });

  it("mirrors with facing exactly as hitboxes do", () => {
    const right = fighterHurtboxes(mario, makeFighter({ x: fx(10), facing: 1, action: "walk", actionFrame: 7, vx: fx(1) }), 0, bake)!;
    const left = fighterHurtboxes(mario, makeFighter({ x: fx(10), facing: -1, action: "walk", actionFrame: 7, vx: fx(-1) }), 0, bake)!;
    right.forEach((c, i) => {
      expect(left[i].x1 - fx(10) + (c.x1 - fx(10))).toBe(0);
      expect(left[i].y1).toBe(c.y1);
      expect(left[i].x2 - fx(10) + (c.x2 - fx(10))).toBe(0);
      expect(left[i].y2).toBe(c.y2);
      expect(left[i].r).toBe(c.r);
    });
  });

  it("has the head capsule reach the top of the body when standing (the overlay anchors there)", () => {
    for (const def of FIGHTERS) {
      const caps = localHurtboxes(def, makeFighter({ defId: def.id }), 0, bake)!;
      const head = bake.hurtboxes(def.id)!.findIndex((h) => h.bone === hurtBonesFor(def.id).head.toLowerCase());
      expect(head, def.id).toBeGreaterThanOrEqual(0);
      // Within a unit, not exactly: Samus's shoulder pads rise 0.3 over her helmet.
      expect(top(caps) - (Math.max(caps[head].y1, caps[head].y2) + caps[head].r), def.id).toBeLessThan(fx(1));
    }
  });

  it("returns null without a bake, so the sim keeps Plan 2's single capsule", () => {
    expect(fighterHurtboxes(mario, makeFighter(), 0, LEGACY_BAKE)).toBeNull();
    expect(bakedEcb(mario, makeFighter(), 0, LEGACY_BAKE)).toBeNull();
  });

  it("indexes an attack by its script's motion frame, a status by its clock", () => {
    expect(poseIndexOf(mario, makeFighter({ action: "attack", move: "jab1", actionFrame: 2 }), 0, bake.clock)).toEqual({
      motion: "attack_11",
      frame: 3,
    });
    expect(poseIndexOf(mario, makeFighter({ action: "crouch", actionFrame: 5 }), 0, bake.clock)?.motion).toBe("status_crouch");
  });
});

describe("the ECB from bones (Plan 4)", () => {
  it("keeps its bottom at the feet and its top over the highest body capsule", () => {
    const e = bakedEcb(mario, makeFighter(), 0, bake)!;
    expect(e.bottom).toBe(0);
    expect(e.top).toBe(top(bodyOf("mario", localHurtboxes(mario, makeFighter(), 0, bake)!)));
  });

  // Fix round 1 (the review's I1): a raised arm is not the body. Donkey Kong's arms
  // over his head in a tumble lifted his ECB to 40.8 against 26.3 standing.
  it("takes its top from the head, the trunk and the legs, never a raised arm", () => {
    const dk = FIGHTERS.find((f) => f.id === "donkeyKong")!;
    const frames = bake.clock("donkeyKong", "status_tumble")!.frames;
    let armsHigher = 0;
    for (let af = 0; af < frames; af++) {
      const f = makeFighter({ defId: "donkeyKong", action: "tumble", actionFrame: af, hitstun: 60 });
      const caps = localHurtboxes(dk, f, 0, bake)!;
      const e = bakedEcb(dk, f, 0, bake)!;
      expect(e.top, `tumble frame ${af}`).toBe(Math.max(top(bodyOf("donkeyKong", caps)), restEcb(dk, bake)!.top >> 1));
      if (top(caps) > e.top) armsHigher++;
    }
    expect(armsHigher, "tumble frames whose arms reach over the body").toBeGreaterThan(0);
  });

  it("names every hurt bone either a body bone or one of the arm chain", () => {
    // So a bone a later skeleton adds is put on one side on purpose, not dropped from the top.
    for (const def of FIGHTERS) {
      const left = bake.hurtboxes(def.id)!.map((h) => h.bone).filter((b) => !ECB_TOP_BONES.has(b));
      expect(left.sort(), def.id).toEqual(["arml", "armr", "shoulderl", "shoulderr"]);
    }
  });

  it("shrinks with a crouch but never below half its standing ECB", () => {
    const stand = bakedEcb(mario, makeFighter(), 0, bake)!;
    const crouch = bakedEcb(mario, makeFighter({ action: "crouch", actionFrame: 10 }), 0, bake)!;
    expect(stand).toEqual(restEcb(mario, bake));
    expect(crouch.top).toBeLessThan(stand.top);
    expect(crouch.top).toBeGreaterThanOrEqual(stand.top >> 1);
    expect(crouch.half).toBeGreaterThanOrEqual(stand.half >> 1);
  });

  it("is as wide as the pelvis capsule (Kirby's Body), not the chest or a limb", () => {
    for (const def of FIGHTERS) {
      const rest = restEcb(def, bake)!;
      const caps = localHurtboxes(def, makeFighter({ defId: def.id }), 0, bake)!;
      const body = bake.hurtboxes(def.id)!.map((h, i) => (ECB_BODY_BONES.has(h.bone) ? i : -1)).filter((i) => i >= 0);
      expect(body.length, def.id).toBe(1);
      expect(rest.half, def.id).toBe(Math.max(...body.map((i) => Math.max(Math.abs(caps[i].x1), Math.abs(caps[i].x2)) + caps[i].r)));
    }
  });
});

/**
 * SSBU sizes replace the legacy boxes (D57): every fighter's standing body is
 * its model's. This ratchet lists both, so any change to a skeleton, a hurt
 * bone or the stand clip shows up as a reviewed diff of these numbers:
 *
 *   UPDATE_HURT=1 pnpm vitest run src/game/hurtboxes.test.ts
 */
describe("body sizes: legacy box beside the bones (Plan 4, hurt.allow.json)", () => {
  const FILE = join(process.cwd(), "src", "game", "hurt.allow.json");
  const now: Record<string, string> = {};
  for (const def of FIGHTERS) {
    const legacy = hurtboxCapsule(makeFighter({ defId: def.id }), def.attributes);
    const rest = restEcb(def, bake)!;
    const n = (v: number) => toFloat(v).toFixed(1);
    now[def.id] = `legacy top ${n(legacy.y2 + legacy.r)} half ${n(def.attributes.width)} / bones top ${n(rest.top)} half ${n(rest.half)}`;
  }
  if (process.env.UPDATE_HURT === "1") {
    it("writes hurt.allow.json", () => {
      writeFileSync(FILE, JSON.stringify(now, null, 2) + "\n");
    });
    return;
  }
  it("are exactly the reviewed numbers", () => {
    expect(now).toEqual(JSON.parse(readFileSync(FILE, "utf8")));
  });
});
