/**
 * The parts of the rig kit whose failure is silent.
 *
 * Everything here is arithmetic that decides how a fighter looks, so getting it
 * wrong produces a picture that is plausible and slightly off rather than an
 * error — the hardest kind of bug to see, and the kind this whole layer exists
 * to prevent.
 */

import { describe, expect, it } from "vitest";
import { roleColour, resolvePalette } from "./rigKit";
import { marth } from "@/fighters/marth";

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
