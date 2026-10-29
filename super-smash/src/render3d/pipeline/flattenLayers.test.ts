// @vitest-environment node
/**
 * `scripts/models/flatten_layers.py` (Plan 4 Task 21b): the eye materials of
 * Mario, Donkey Kong, Link, Fox and Marth layer an iris (its own UV map, its
 * alpha the mix factor) over the eye white, and glTF has one colour texture
 * per material. The export kept one layer — blank white eyes for most, Fox's
 * iris alone with holes for the white — so it now flattens the two into one
 * texture on the white's UV map, the iris where the file puts it.
 *
 * The module is plain Python (Blender's and this machine's), run here as
 * `python3 -I -B` on invented images of a few texels: numbers only.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MODULE_DIR = join(process.cwd(), "scripts", "models");

interface Img {
  readonly width: number;
  readonly height: number;
  /** RGBA floats, rows bottom-up (Blender's `Image.pixels`). */
  readonly pixels: readonly number[];
  readonly extension?: string;
}
type UV = readonly [number, number];
type Tri = readonly [readonly [UV, UV, UV], readonly [UV, UV, UV]];

function flatten(base: Img, overlay: Img, triangles: readonly Tri[]): { pixels?: number[]; size?: [number, number]; error?: string } {
  const code = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(MODULE_DIR)})`,
    "import flatten_layers as fl",
    "a = json.load(sys.stdin)",
    "try:",
    "    px, size = fl.flatten(fl.Layer(**a['base']), fl.Layer(**a['overlay']), a['triangles'])",
    "    print(json.dumps({'pixels': [round(v, 4) for v in px], 'size': size}))",
    "except fl.FlattenError as e:",
    "    print(json.dumps({'error': str(e)}))",
  ].join("\n");
  const r = spawnSync("python3", ["-I", "-B", "-c", code], {
    input: JSON.stringify({ base: { extension: "REPEAT", ...base }, overlay: { extension: "REPEAT", ...overlay }, triangles }),
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(r.stderr).toBe("");
  return JSON.parse(r.stdout);
}

/** An image of `w`×`h` texels, every texel `rgba` except those `at` gives. */
const image = (w: number, h: number, rgba: readonly number[], at: Record<string, readonly number[]> = {}): Img => ({
  width: w,
  height: h,
  pixels: Array.from({ length: w * h }, (_, k) => at[`${k % w},${Math.floor(k / w)}`] ?? rgba).flat(),
});
const texel = (out: { pixels?: number[]; size?: [number, number] }, x: number, y: number) => out.pixels!.slice((y * out.size![0] + x) * 4, (y * out.size![0] + x) * 4 + 4);
/** Two triangles over the unit square, the overlay's UVs `shift` from the base's. */
const square = (shift: UV = [0, 0], baseShift: UV = [0, 0]): Tri[] => {
  const corners: UV[][] = [
    [[0, 0], [1, 0], [1, 1]],
    [[0, 0], [1, 1], [0, 1]],
  ];
  return corners.map((t) => [t.map(([u, v]) => [u + baseShift[0], v + baseShift[1]]) as unknown as [UV, UV, UV], t.map(([u, v]) => [u + shift[0], v + shift[1]]) as unknown as [UV, UV, UV]]);
};

const WHITE = [1, 1, 1, 1];
/** A transparent texel whose colour is junk: it must not bleed into the result. */
const CLEAR = [1, 0, 0, 0];
const IRIS = [0, 0, 0, 1];

describe("flattening an iris layer onto the eye white", () => {
  it("puts the iris where the overlay's UVs put it, and the white everywhere else, all opaque", () => {
    const out = flatten(image(2, 2, WHITE), image(2, 2, CLEAR, { "1,1": IRIS }), square());
    expect(out.size).toEqual([2, 2]);
    expect(texel(out, 1, 1)).toEqual([0, 0, 0, 1]);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) expect(texel(out, x, y)).toEqual([1, 1, 1, 1]);
  });

  it("follows an offset iris UV map (Mario's and Marth's are their own), repeating as the file's textures do", () => {
    const out = flatten(image(2, 2, WHITE), image(2, 2, CLEAR, { "0,0": IRIS }), square([0.5, 0]));
    expect(texel(out, 1, 0)).toEqual([0, 0, 0, 1]);
    expect(texel(out, 0, 0)).toEqual([1, 1, 1, 1]);
  });

  it("reads a white whose UVs sit one repeat over (Link's left eye, u in -0.97..-0.03) as the same texture", () => {
    const out = flatten(image(2, 2, WHITE), image(2, 2, CLEAR, { "1,1": IRIS }), square([0, 0], [-1, 0]));
    expect(texel(out, 1, 1)).toEqual([0, 0, 0, 1]);
    expect(texel(out, 0, 1)).toEqual([1, 1, 1, 1]);
  });

  it("mixes in linear light, as Blender's shader does: half a black iris over white is sRGB 0.7354, not 0.5", () => {
    const out = flatten(image(1, 1, WHITE), image(1, 1, [0, 0, 0, 0.5]), square());
    expect(texel(out, 0, 0)).toEqual([0.7354, 0.7354, 0.7354, 1]);
  });

  it("is as large as the larger layer (Fox: a 128-texel white under a 256-texel iris)", () => {
    const out = flatten(image(1, 1, WHITE), image(4, 4, CLEAR, { "3,3": IRIS }), square());
    expect(out.size).toEqual([4, 4]);
    expect(texel(out, 3, 3)).toEqual([0, 0, 0, 1]);
    expect(texel(out, 0, 0)).toEqual([1, 1, 1, 1]);
  });

  it("carries the iris two texels past the triangles, for filtering, and leaves the white alone beyond", () => {
    const small: Tri = [
      [[0, 0], [0.125, 0], [0, 0.125]],
      [[0, 0], [0.125, 0], [0, 0.125]],
    ];
    const out = flatten(image(8, 8, WHITE), image(8, 8, IRIS), [small]);
    expect(texel(out, 0, 0)).toEqual([0, 0, 0, 1]);
    expect(texel(out, 2, 2)).toEqual([0, 0, 0, 1]);
    expect(texel(out, 3, 3)).toEqual([1, 1, 1, 1]);
    expect(texel(out, 7, 7)).toEqual([1, 1, 1, 1]);
  });

  it("refuses a triangle across a repeat boundary, and one texel mapped to two iris places", () => {
    const across: Tri = [
      [[0.5, 0], [1.5, 0], [0.5, 1]],
      [[0.5, 0], [1.5, 0], [0.5, 1]],
    ];
    expect(flatten(image(2, 2, WHITE), image(2, 2, CLEAR), [across]).error).toBe("a triangle crosses a texture repeat boundary in the base layer's UVs");
    const mirrored: Tri[] = [...square(), ...square([0.5, 0])];
    expect(flatten(image(2, 2, WHITE), image(2, 2, CLEAR), mirrored).error).toMatch(/^texel \d+,\d+ of the base layer maps to two places in the overlay \(/);
  });
});
