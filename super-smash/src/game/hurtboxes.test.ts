import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_BAKE } from "@/engine/acmd/bakeTables";
import { bakedEcb, ECB_BODY_BONES, fighterHurtboxes, localHurtboxes, restEcb } from "@/engine/acmd/hurtboxes";
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
  it("keeps its bottom at the feet and its top over the head", () => {
    const e = bakedEcb(mario, makeFighter(), 0, bake)!;
    expect(e.bottom).toBe(0);
    expect(e.top).toBe(top(localHurtboxes(mario, makeFighter(), 0, bake)!));
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
