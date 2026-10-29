import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { LEGACY_BAKE } from "@/engine/acmd/bakeTables";
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
import { fx, toFloat } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { overlayAnchor } from "./anchors";
import { fighterPoser } from "./bake/bake";
import { createFighter3D } from "./fighter3d";
import { parseSkeletonFile } from "./skeleton/skeleton";
import { hurtBonesFor } from "./skeletons/hurtBones";

const bake = readBakeFromDisk();
// The game's Donkey Kong: limb-bone scripts on, placed through the bake (ruling R1).
const dk = withLimbScripts(FIGHTERS.find((f) => f.id === "donkeyKong")!, bake.bones);

describe("where the overlay hangs a fighter's tag (Plan 4)", () => {
  it("is the top of the head hurt capsule, over the head, mirrored by facing", () => {
    for (const facing of [1, -1]) {
      const f = makeFighter({ defId: "donkeyKong", facing });
      const a = overlayAnchor(dk, f, 0, bake)!;
      const caps = localHurtboxes(dk, f, 0, bake)!;
      const head = caps[bake.hurtboxes("donkeyKong")!.findIndex((h) => h.bone === "head")];
      expect(a.headTop).toBeCloseTo(toFloat(Math.max(head.y1, head.y2) + head.r), 6);
      expect(a.headX).toBeCloseTo(facing * toFloat((head.x1 + head.x2) / 2), 6);
      expect(a.headTop).toBeGreaterThan(20); // SSBU DK, not his 2D rig's 11
    }
  });

  it("follows the head bone Fighter3D draws: the head comes down in a crouch", () => {
    const stand = overlayAnchor(dk, makeFighter({ defId: "donkeyKong" }), 0, bake)!;
    const crouch = overlayAnchor(dk, makeFighter({ defId: "donkeyKong", action: "crouch", actionFrame: 10 }), 0, bake)!;
    expect(crouch.headTop).toBeLessThan(stand.headTop - 1); // 26.3 → 25.1: DK crouches on short legs
    const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "donkeyKong.json"), "utf8")));
    const fighter = createFighter3D({ def: dk, port: 0, poser: fighterPoser(dk, skeleton), bake, model: { kind: "standIn", reason: "test" } });
    const f = makeFighter({ defId: "donkeyKong", x: fx(3), action: "crouch", actionFrame: 10 });
    fighter.update({ f, x: 3, y: 0, frame: 0, blends: null, hitFlash: 0, hidden: false });
    const p = new Vector3();
    expect(fighter.bonePosition("head", p)).toBe(true);
    // The tag sits over the head bone: within the head capsule's own reach of it.
    expect(Math.abs(3 + crouch.headX - p.x)).toBeLessThan(6);
    expect(crouch.headTop).toBeGreaterThan(p.y);
    fighter.dispose();
  });

  it("is Kirby's body, his whole round self, where his head bone list says", () => {
    const kirby = withLimbScripts(FIGHTERS.find((f) => f.id === "kirby")!, bake.bones);
    const f = makeFighter({ defId: "kirby" });
    const a = overlayAnchor(kirby, f, 0, bake)!;
    const caps = localHurtboxes(kirby, f, 0, bake)!;
    const body = caps[bake.hurtboxes("kirby")!.findIndex((h) => h.bone === hurtBonesFor("kirby").head.toLowerCase())];
    expect(a.headTop).toBeCloseTo(toFloat(Math.max(body.y1, body.y2) + body.r), 6);
  });

  it("is null without a bake, so the overlay falls back to the 2D rig", () => {
    expect(overlayAnchor(dk, makeFighter({ defId: "donkeyKong" }), 0, LEGACY_BAKE)).toBeNull();
    expect(overlayAnchor(dk, makeFighter({ defId: "donkeyKong" }), 0, undefined)).toBeNull();
  });
});
