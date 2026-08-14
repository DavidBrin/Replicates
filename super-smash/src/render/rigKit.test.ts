/**
 * The parts of the rig kit whose failure is silent.
 *
 * Everything here is arithmetic that decides how a fighter looks, so getting it
 * wrong produces a picture that is plausible and slightly off rather than an
 * error — the hardest kind of bug to see, and the kind this whole layer exists
 * to prevent.
 */

import { describe, expect, it } from "vitest";
import { CHARACTER_RIGS } from "./chars";
import { propAnimFor, rimWidthFor, roleColour, resolvePalette } from "./rigKit";
import { MIN_ZOOM } from "./camera";
import { marth } from "@/fighters/marth";

/**
 * The outline is proportional to the fighter at *every* zoom.
 *
 * A flat screen-space width gave a small fighter a proportionally enormous
 * outline — at zoom 12 against head radius, Fox 30% and Pikachu 29% against
 * Kirby's 16%, and a third of Pikachu's painted pixels. Scaling by `rig.scale`
 * fixed that at ordinary zooms and left it broken at low ones, because the
 * floor was outside the multiplication: `Math.max(2.5, zoom * 0.55 * scale)`
 * picks the flat 2.5 for every rig once `zoom * 0.55` drops below it, and at
 * `MIN_ZOOM` it does for all eight.
 *
 * That is the zoom where four fighters are on screen and the outline matters
 * most, so the version that "fixed" the proportionality had quietly excluded
 * the case it was needed for. Found by review, not by looking.
 */
describe("the outline's width", () => {
  const scales = Object.entries(CHARACTER_RIGS)
    .filter(([k]) => !["default", "dk", "donkey-kong"].includes(k))
    .map(([k, r]) => [k, r.scale] as const);

  it("has rigs of genuinely different scale to compare", () => {
    const values = scales.map(([, s]) => s);
    expect(Math.max(...values) / Math.min(...values), "every rig is the same size").toBeGreaterThan(1.3);
  });

  it("stays proportional at the zoom floor, where it used to go flat", () => {
    // `MIN_ZOOM * 0.55` is under the floor, so this is exactly the case that
    // collapsed to one width for the whole roster.
    expect(MIN_ZOOM * 0.55).toBeLessThan(2.5);
    const widths = new Set(scales.map(([, s]) => rimWidthFor(s, MIN_ZOOM).toFixed(4)));
    expect(widths.size, "every fighter got the same outline at the zoom floor").toBeGreaterThan(1);
  });

  it("gives a bigger rig a thicker outline, at any zoom", () => {
    for (const zoom of [MIN_ZOOM, 6, 12, 30]) {
      const sorted = [...scales].sort((a, b) => a[1] - b[1]);
      const thinnest = rimWidthFor(sorted[0][1], zoom);
      const thickest = rimWidthFor(sorted[sorted.length - 1][1], zoom);
      expect(thickest, `at zoom ${zoom}`).toBeGreaterThan(thinnest);
    }
  });

  it("is a fixed ratio between two rigs, however far out the camera is", () => {
    // The property that makes it "proportional" rather than merely "bigger":
    // the ratio between two fighters' outlines must not depend on the zoom.
    const a = 0.72;
    const b = 1.16;
    const ratios = [MIN_ZOOM, 5, 12, 40].map((z) => rimWidthFor(b, z) / rimWidthFor(a, z));
    for (const r of ratios) expect(r).toBeCloseTo(b / a, 6);
  });

  it("grows with the zoom, above the floor", () => {
    // Without this, `return 3 * rigScale` passes every other assertion in this
    // block: the widths differ by rig, hold their ratio and clear the floor,
    // while ignoring the camera entirely. Pinned on both sides of the floor
    // because the two regimes are different code paths.
    const s = 0.9;
    const belowFloor = rimWidthFor(s, MIN_ZOOM);
    const atFloorEdge = rimWidthFor(s, 2.5 / 0.55);
    const wellAbove = rimWidthFor(s, 40);
    expect(belowFloor, "the floor is not holding").toBeCloseTo(2.5 * s, 9);
    expect(atFloorEdge).toBeCloseTo(belowFloor, 6);
    expect(wellAbove, "the width ignores the zoom").toBeGreaterThan(belowFloor * 3);
    expect(wellAbove).toBeCloseTo(40 * 0.55 * s, 9);
  });

  it("still never vanishes", () => {
    // The floor exists so the outline survives a zoomed-out match. Scaling it
    // must not take it to nothing on the smallest fighter.
    const smallest = Math.min(...scales.map(([, s]) => s));
    expect(rimWidthFor(smallest, MIN_ZOOM)).toBeGreaterThan(1);
  });
});

/**
 * The fifth palette role.
 *
 * Added for Marth's cape, which had to become a hard-coded literal to stay
 * legible — every one of the four roles merged it with the tunic or the boots —
 * and a literal does not follow a costume, so the *red-caped* alt came out
 * light blue.
 */
describe("the extra role", () => {
  it("falls back to accent for a fighter who declares none", () => {
    // Not to the literal string "extra": `fillStyle` ignores an unparseable
    // colour silently, leaving the shape painted in whatever was set last.
    const plain = resolvePalette(null, 0);
    expect(plain.extra).toBeUndefined();
    expect(roleColour("extra", plain)).toBe(plain.accent);
  });

  it("takes an alt's own value where the alt declares one", () => {
    // Against the alt's *declared* colour, not merely "not the accent". The
    // first version asserted the latter, which Marth's default blue satisfies
    // for every costume — so an implementation that ignored the alt entirely
    // and left the red costume's cape blue passed it. That is precisely the
    // bug the role was added to fix.
    marth.palette.alts.forEach((alt, i) => {
      if (alt.extra === undefined) return;
      expect(roleColour("extra", resolvePalette(marth, i + 1)), `costume ${i + 1} ignored its cape`).toBe(
        alt.extra,
      );
    });
  });

  it("has an alt that declares one, or the test above proves nothing", () => {
    expect(marth.palette.alts.some((a) => a.extra !== undefined)).toBe(true);
  });

  it("keeps the default on an alt that declares none", () => {
    marth.palette.alts.forEach((alt, i) => {
      if (alt.extra !== undefined) return;
      expect(roleColour("extra", resolvePalette(marth, i + 1))).toBe(marth.palette.extra);
    });
  });
});

/**
 * `t` distinguishes "performing a move" from "not", including on frame one.
 *
 * Fox damps his tail on `anim.t > 0` and Kirby suppresses his blink on it, so
 * the flag has to be true for every frame of a move. `actionFrame` starts at 0
 * and that frame is drawn, so dividing it directly made the *opening* frame of
 * every attack indistinguishable from standing still — both characters spent
 * frame one in their idle behaviour, on every move they have.
 */
describe("a prop's sense of move time", () => {
  const frames = { vx: 0, vy: 0, facing: 1, grounded: true } as const;

  it("is above zero on the very first frame of a move", () => {
    const t = propAnimFor({ ...frames, actionFrame: 0 }, 0, 30).t;
    expect(t, "frame one of a move reads as no move at all").toBeGreaterThan(0);
  });

  it("is exactly zero when no move is being performed", () => {
    // `totalFrames` of 0 is the only signal for this, so it must stay distinct.
    expect(propAnimFor({ ...frames, actionFrame: 0 }, 0, 0).t).toBe(0);
    expect(propAnimFor({ ...frames, actionFrame: 12 }, 0, 0).t).toBe(0);
  });

  it("rises across the move and never passes one", () => {
    const at = (n: number) => propAnimFor({ ...frames, actionFrame: n }, 0, 20).t;
    expect(at(0)).toBeLessThan(at(10));
    expect(at(10)).toBeLessThan(at(19));
    expect(at(19)).toBeLessThanOrEqual(1);
    // Past the end — a clip can be sampled beyond its own length during a
    // blend — must clamp rather than run away.
    expect(at(400)).toBe(1);
  });
});
