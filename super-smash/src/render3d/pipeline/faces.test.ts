// @vitest-environment node
/**
 * Every fighter's face (Plan 4 Task 21b). The lab showed Mario with blank eyes,
 * Donkey Kong with a hole between his hair and his muzzle, and Fox with holes
 * where the whites of his eyes are. The causes were in the export: the upper
 * face Donkey Kong's file shows by default was dropped, his body (opaque in its
 * source) was cut by his fur card's alpha, and the eye materials that layer an
 * iris over the eye white kept one layer. These tests pin the face each
 * fighter must export and how it must ship.
 *
 * Names and numbers only: the committed half reads `scripts/models/meshes.json`;
 * the local half reads this checkout's own build (the Blender dumps in
 * `.model-cache/dumps/` and the glbs in `public/models/`, both git-ignored) and
 * is skipped where `pnpm models` has not run.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { describe, expect, it } from "vitest";

import { FIGHTER_IDS } from "@/fighters";
import { faceProblems, verifyGlb } from "../../../scripts/models/glb.mjs";
import { parseBoneDump } from "./dump";

const ROOT = process.cwd();
interface MeshRules {
  readonly keep: readonly string[];
  readonly drop: readonly string[];
  readonly drawOnly?: readonly string[];
  readonly face?: readonly string[];
}
const RULES = JSON.parse(readFileSync(join(ROOT, "scripts", "models", "meshes.json"), "utf8")) as Record<string, MeshRules>;

describe("meshes.json names every fighter's neutral face, and exports all of it", () => {
  it.each(FIGHTER_IDS)("%s: lists its face meshes, an eye among them, each one exported and none dropped", (id) => {
    const r = RULES[id];
    const drawn = new Set([...r.keep, ...(r.drawOnly ?? [])]);
    expect(r.face?.length, `${id} names no face meshes`).toBeGreaterThan(0);
    for (const name of r.face ?? []) {
      expect(drawn.has(name), `${id}: face mesh ${name} is not exported`).toBe(true);
      expect(r.drop, `${id}: face mesh ${name} is dropped`).not.toContain(name);
    }
    expect(r.face?.some((n) => /eye/i.test(n)), `${id}: no eye among its face meshes`).toBe(true);
    // Every mesh is decided once: exported and measured, exported only, or dropped.
    const all = [...r.keep, ...(r.drawOnly ?? []), ...r.drop];
    expect(new Set(all).size, `${id}: a mesh is listed twice`).toBe(all.length);
  });

  it("draws Donkey Kong's upper face, the one his file shows by default, without measuring it into a hurtbox", () => {
    // donkey_FaceUP1 is his brow and open eyelids, the only FaceUP variant in the file's visible collection
    // (FaceUP2-8 sit in the excluded "Expressions"). Kept as drawOnly: its 194 Head-weighted vertices would move
    // the committed Head hurt capsule (r 5.22146 -> 5.13582), and with it the skeleton, the bake and the golden.
    expect(RULES.donkeyKong.drawOnly).toEqual(["donkey_FaceUP1_VIS_O_OBJShape"]);
    expect(RULES.donkeyKong.face).toContain("donkey_FaceUP1_VIS_O_OBJShape");
    expect(FIGHTER_IDS.filter((id) => (RULES[id].drawOnly ?? []).length > 0)).toEqual(["donkeyKong"]);
  });
});

/**
 * The alpha mode each fighter's face materials ship with, read back from the
 * built glbs. The eyes that layered an iris over the eye white are now one
 * opaque texture each (Fox's were MASK, with holes where the white was; Link's
 * and Marth's two eyes flatten to two textures). Donkey Kong's face skin is his
 * `body`, OPAQUE, no longer folded into his fur card's MASK. MASK is left only
 * where the source material reads its texture's alpha: Pikachu's eye cards,
 * Link's lashes, Marth's brows and Fox's fur edge.
 */
const FACE_ALPHA: Record<string, Record<string, "OPAQUE" | "MASK">> = {
  mario: { EyeL: "OPAQUE", alp_mario_002: "OPAQUE", skin_mario_001: "OPAQUE" },
  donkeyKong: { EyeL: "OPAQUE", body: "OPAQUE" },
  link: { EyeL: "OPAQUE", EyeR: "OPAQUE", skin_link_001: "OPAQUE", alp_link_002: "MASK" },
  samus: { EyeL: "OPAQUE" },
  kirby: { EyeL6: "OPAQUE" },
  fox: { EyeL: "OPAQUE", head_fox_001: "MASK" },
  pikachu: { EyeL: "MASK", pikachu_facial_03: "OPAQUE" },
  marth: { EyeL: "OPAQUE", EyeR: "OPAQUE", alp_marth_005: "MASK", skin_marth_001: "OPAQUE" },
};

describe("this checkout's build (when `pnpm models` has run)", () => {
  const dumpFile = (id: string) => join(ROOT, ".model-cache", "dumps", `${id}.json`);
  const indexFile = join(ROOT, "public", "models", "index.json");
  const index = existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as { models: Record<string, { file: string }> }) : null;
  const built = FIGHTER_IDS.filter((id) => existsSync(dumpFile(id)) && index?.models[id] !== undefined);

  it.skipIf(built.length === 0).each(built)("%s: every face mesh is in the dump, drawn, and its materials pass the face checks", async (id) => {
    const dump = parseBoneDump(JSON.parse(readFileSync(dumpFile(id), "utf8")));
    const faces = dump.meshes.filter((m) => m.face);
    const base = (name: string) => name.replace(/\.\d+$/, "");
    expect([...new Set(faces.map((m) => base(m.name)))].sort()).toEqual([...(RULES[id].face ?? [])].sort());
    for (const m of faces) expect(m.kept || m.drawOnly, `${id} ${m.name}`).toBe(true);

    const file = join(ROOT, "public", "models", index!.models[id].file);
    await MeshoptDecoder.ready;
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder }).read(file);
    expect(await faceProblems(doc, dump)).toEqual([]);
    const modes = Object.fromEntries(
      [...new Set(faces.flatMap((m) => m.materials ?? []))].sort().map((name) => [name, doc.getRoot().listMaterials().find((x) => x.getName() === name)?.getAlphaMode()]),
    );
    expect(modes).toEqual(Object.fromEntries(Object.entries(FACE_ALPHA[id]).sort()));
    expect((await verifyGlb(file, dump)).problems).toEqual([]);
  });
});
