// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { prepareFighterScripts } from "@/engine/acmd/run";
import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import type { AcmdCommand } from "@/engine/acmd/types";
import { fx } from "@/engine/fixed";
import type { MoveSlot } from "@/engine/types";
import { readBakeFromDisk } from "@/game/bakeNode";
import { boneRole, placeableBone } from "@/render3d/retarget/placeable";
import { SKELETONS } from "@/render3d/skeletons";
import { FIGHTERS } from "../index";
import { ACTIVE_SCRIPT_SLOTS, activatable, withReferenceScripts } from "./active";
import { REFERENCE_SCRIPTS } from "./index";
import { LIMB_HOLD, LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";

/**
 * Which limb-bone scripts the game runs (Plan 4, Task 13). Regenerate after a
 * skeleton, script or move change with
 *
 *   UPDATE_LIMB=1 pnpm vitest run src/fighters/acmd/limb.test.ts
 *
 * and name the slots that moved, and why, in the commit.
 */

const FILE = join(process.cwd(), "src", "fighters", "acmd", "limb.json");
const UPDATING = process.env.UPDATE_LIMB === "1";
const bake = readBakeFromDisk();

/**
 * The bones a box may hang off once the bake places it (ruling R12): the root,
 * a bone a clip drives, or one riding a driven bone rigidly. Not a bone under
 * the root that no clip moves (Samus's `throw`): Ultimate animates it, our clips
 * never do (`render3d/retarget/placeable.ts`).
 */
const placeableFor = (id: string) => (bone: string) => placeableBone(SKELETONS[id], bone);

/** Every bone of the committed skeleton, and the root: the rule as first written, before R12. */
const anySkeletonBone = (id: string) => (bone: string) => bone === "top" || boneRole(SKELETONS[id], bone).kind !== "missing";

const HELD = new Map(LIMB_HOLD.map((h) => [`${h.fighter} ${h.move}`, h.reason]));

/**
 * The rule's output: the slots `activatable` admits with the bones the bake can
 * place, minus Plan 3's, minus the held ones (`limb.hold.json`).
 */
function census(placeableOf = placeableFor): { slots: Record<string, MoveSlot[]>; blocked: string[]; held: string[] } {
  const slots: Record<string, MoveSlot[]> = {};
  const blocked: string[] = [];
  const held: string[] = [];
  for (const def of FIGHTERS) {
    const ref = REFERENCE_SCRIPTS[def.id];
    const placeable = placeableOf(def.id);
    slots[def.id] = [];
    for (const [slot, key] of Object.entries(ref.slots) as [MoveSlot, string][]) {
      if (ACTIVE_SCRIPT_SLOTS[def.id]?.includes(slot)) continue;
      const script = ref.scripts[key];
      const limbs = [...scriptBoneNames(script.commands)];
      if (limbs.length === 0) continue;
      if (!activatable(slot, def.moves[slot], script, placeable)) blocked.push(`${def.id} ${slot} (${limbs.join("/")})`);
      else if (HELD.has(`${def.id} ${slot}`)) held.push(`${def.id} ${slot}`);
      else slots[def.id].push(slot);
    }
    slots[def.id].sort();
  }
  return { slots, blocked, held };
}

describe("running the limb-bone scripts (Plan 4)", () => {
  const now = census();

  if (UPDATING) {
    it("writes limb.json", () => {
      writeFileSync(FILE, JSON.stringify(now.slots, null, 2) + "\n");
      console.log(`limb-bone scripts left on legacy moves (Plan 3's rules):\n${now.blocked.join("\n")}\nheld:\n${now.held.join("\n")}`);
    });
    return;
  }

  it("lists exactly the slots the widened rule admits", () => {
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(now.slots);
  });

  it("leaves out, for a bone no clip moves, exactly Samus's two grabs (their claw rides `throw`)", () => {
    const wide = census(anySkeletonBone);
    const dropped = FIGHTERS.flatMap((f) =>
      [...wide.slots[f.id], ...wide.held.filter((k) => k.startsWith(`${f.id} `)).map((k) => k.split(" ")[1] as MoveSlot)]
        .filter((slot) => !now.slots[f.id].includes(slot) && !now.held.includes(`${f.id} ${slot}`))
        .map((slot) => `${f.id} ${slot}`),
    );
    expect(dropped.sort()).toEqual(["samus dashGrab", "samus grab"]);
  });

  it("switches some on (not vacuous, D47)", () => {
    expect(Object.values(LIMB_SCRIPT_SLOTS).flat().length).toBeGreaterThan(0);
  });

  it("hands the game the imported script for a listed slot and leaves the rest as Plan 3 had them", () => {
    for (const def of FIGHTERS) {
      const game = withLimbScripts(def, bake.bones);
      const ref = REFERENCE_SCRIPTS[def.id];
      for (const slot of LIMB_SCRIPT_SLOTS[def.id] ?? []) expect(game.scripts?.[slot]).toBe(ref.scripts[ref.slots[slot]!]);
      for (const slot of ACTIVE_SCRIPT_SLOTS[def.id] ?? []) expect(game.scripts?.[slot]).toBe(def.scripts?.[slot]);
      expect(withLimbScripts(def, bake.bones)).toBe(game);
    }
  });
});

/*
 * Ruling R12: a box goes where our clip, or the fighter, puts its bone. The root
 * goes with the fighter; a driven bone and anything rigid on it go with the clip;
 * a bone under the root that no clip drives stays at its bind pose, at the feet.
 */
describe.skipIf(UPDATING)("the bones a box may hang off (ruling R12)", () => {
  it.each([
    ["samus", "top", "root"],
    ["pikachu", "trans", "root"],
    ["mario", "kneer", "driven"],
    ["link", "sword2", "rides"],
    ["mario", "toel", "rides"],
    ["samus", "throw", "unanimated"],
    ["pikachu", "rot", "unanimated"],
    ["mario", "nosuchbone", "missing"],
  ] as const)("%s %s is %s", (id, bone, kind) => {
    expect(boneRole(SKELETONS[id], bone).kind).toBe(kind);
    expect(placeableBone(SKELETONS[id], bone)).toBe(kind === "root" || kind === "driven" || kind === "rides");
  });

  it("names the driven bone a riding one is rigid on", () => {
    expect(boneRole(SKELETONS.link, "sword2")).toEqual({ kind: "rides", on: "handr" });
    expect(boneRole(SKELETONS.mario, "toel")).toEqual({ kind: "rides", on: "footl" });
  });

  it("places every box of every slot the game runs limb-bone scripts in", () => {
    const off: string[] = [];
    for (const def of FIGHTERS) {
      const ref = REFERENCE_SCRIPTS[def.id];
      for (const slot of LIMB_SCRIPT_SLOTS[def.id] ?? []) {
        for (const bone of scriptBoneNames(ref.scripts[ref.slots[slot]!].commands)) {
          if (!placeableBone(SKELETONS[def.id], bone)) off.push(`${def.id} ${slot} ${bone}`);
        }
      }
    }
    expect(off).toEqual([]);
  });
});

/*
 * Slots the rule admits whose boxes our clips put somewhere a player would call
 * wrong (the Task 13 review's per-frame survey): they keep their legacy table
 * until their clip is fixed (Task 13b), which is the only change this list may
 * see — entries leave it, none join. Pinned here, as the status-driven slots are.
 */
describe.skipIf(UPDATING)("the held slots (limb.hold.json)", () => {
  const PINNED: readonly (readonly [string, MoveSlot])[] = [
    ["samus", "dair"],
    ["donkeyKong", "bair"],
    ["mario", "fair"],
    ["fox", "nair"],
    ["marth", "dair"],
    ["mario", "nair"],
    ["fox", "dair"],
  ];

  it("are exactly these, each with the placement fault it waits on", () => {
    expect(LIMB_HOLD.map((h) => [h.fighter, h.move])).toEqual(PINNED);
    for (const h of LIMB_HOLD) expect(h.reason, `${h.fighter} ${h.move}`).toMatch(/^placement/);
  });

  it("are slots the rule admits: a hold on a slot it refuses is stale", () => {
    const admitted = census(placeableFor);
    expect(admitted.held.sort()).toEqual(PINNED.map(([f, m]) => `${f} ${m}`).sort());
  });

  it("stay on their legacy move in the game's form of the fighter", () => {
    for (const [id, slot] of PINNED) {
      const legacy = FIGHTERS.find((f) => f.id === id)!;
      const game = withLimbScripts(legacy, bake.bones);
      expect(LIMB_SCRIPT_SLOTS[id] ?? [], `${id} ${slot}`).not.toContain(slot);
      expect(game.scripts?.[slot], `${id} ${slot}`).toBe(legacy.scripts?.[slot]);
      expect(game.moves[slot], `${id} ${slot}`).toBe(legacy.moves[slot]);
    }
  });
});

/*
 * Ruling R1(a): a limb slot's `MoveDef` table is its script's boxes placed through
 * the bake (the CPU's reach, the swing, the timing and the charge hold read it), so
 * the game's form of a fighter depends on the bone table as well as the def. The
 * bake's own input is the one form with no table to place through (`null`): the
 * scripts and their published lengths, the legacy tables kept.
 */
describe.skipIf(UPDATING)("the game's form of a fighter, per bone table (ruling R1(a))", () => {
  const MARIO = FIGHTERS.find((f) => f.id === "mario")!;

  it("is one object per def and table, and another for another table", () => {
    const game = withLimbScripts(MARIO, bake.bones);
    expect(withLimbScripts(MARIO, bake.bones)).toBe(game);
    const other = withLimbScripts(MARIO, { ...bake.bones });
    expect(other).not.toBe(game);
    expect(other.moves).toEqual(game.moves);
    expect(withLimbScripts(MARIO, null)).not.toBe(game);
    expect(withLimbScripts(MARIO, null)).toBe(withLimbScripts(MARIO, null));
  });

  it("places a limb slot's synced table through the table it is given", () => {
    const game = withLimbScripts(MARIO, bake.bones);
    for (const slot of LIMB_SCRIPT_SLOTS.mario) {
      expect(game.moves[slot]!.hitboxes, `mario ${slot}`).not.toEqual(MARIO.moves[slot]!.hitboxes);
      expect(game.moves[slot]!.hitboxes.length, `mario ${slot}`).toBeGreaterThan(0);
    }
  });

  it("without a table, runs the scripts at their published length and keeps the legacy tables (the bake's input)", () => {
    const input = withLimbScripts(MARIO, null);
    const ref = REFERENCE_SCRIPTS.mario;
    for (const slot of LIMB_SCRIPT_SLOTS.mario) {
      const key = ref.slots[slot]!;
      expect(input.scripts?.[slot], `mario ${slot}`).toBe(ref.scripts[key]);
      expect(input.moves[slot]!.hitboxes, `mario ${slot}`).toBe(MARIO.moves[slot]!.hitboxes);
      const faf = ref.faf[key];
      if (faf !== undefined) expect(input.moves[slot]!.totalFrames, `mario ${slot}`).toBe(faf - 1);
      expect(withLimbScripts(MARIO, bake.bones).moves[slot]!.totalFrames, `mario ${slot}`).toBe(input.moves[slot]!.totalFrames);
    }
  });

  it("cannot be placed through the root-bone table: a limb box needs the bake", () => {
    expect(() => withLimbScripts(MARIO, LEGACY_BONE_TABLE)).toThrow(/mario \w+ \(game_\w+\): no pose for bone "\w+"/);
  });

  it("loads against the bake: every listed script passes the load check on the bake's bones", () => {
    for (const def of FIGHTERS) expect(() => prepareFighterScripts(withLimbScripts(def, bake.bones), bake.bones), def.id).not.toThrow();
  });
});

/** Every ATTACK in a script, loops included. */
function attacks(commands: readonly AcmdCommand[]): Extract<AcmdCommand, { op: "attack" }>[] {
  return commands.flatMap((c) => (c.op === "attack" ? [c] : c.op === "loop" ? attacks(c.body) : []));
}

/*
 * Plan 3, Task 19: the engine models autolink angles 365 and 367 only. Donkey Kong's
 * Spinning Kong (366°, `game_specialhi`) and Samus's up smash (368°, `game_attackhi4`)
 * hang their boxes off limbs the bake now places, and still stay on their legacy
 * moves: the widened bone rule changes which bones, nothing else.
 */
describe.skipIf(UPDATING).each([
  ["donkeyKong", "upB", 366],
  ["samus", "usmash", 368],
] as const)("%s %s, a box at %i°", (id, slot, angle) => {
  const def = FIGHTERS.find((f) => f.id === id)!;
  const ref = REFERENCE_SCRIPTS[id];
  const script = ref.scripts[ref.slots[slot]!];

  it("hangs its boxes off bones the bake places, one of them at that angle", () => {
    const bones = [...scriptBoneNames(script.commands)];
    expect(bones.length).toBeGreaterThan(0);
    expect(bones.every(placeableFor(id)), bones.join("/")).toBe(true);
    expect(attacks(script.commands).some((a) => a.params.angle === fx(angle))).toBe(true);
  });

  it("is not switched on", () => {
    expect(activatable(slot, def.moves[slot], script, placeableFor(id))).toBe(false);
    expect(LIMB_SCRIPT_SLOTS[id] ?? []).not.toContain(slot);
    expect(withLimbScripts(def, bake.bones).scripts?.[slot]).toBeUndefined();
  });

  it("would be refused at load, against the bake's bones, if it were", () => {
    const forced = withReferenceScripts(def, ref, [slot], null);
    expect(() => prepareFighterScripts(forced, bake.bones)).toThrow(new RegExp(`${id} ${slot}: hitbox \\d+ has angle ${angle}°`));
  });
});
