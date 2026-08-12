import { describe, expect, it } from "vitest";

import { assignmentsTo, callsOf, countCapsules, countOf, createMockContext } from "./mockContext";
import {
  CHARACTER_RIGS,
  PORT_COLOURS,
  REST_SAMPLE,
  drawFigure,
  drawHeadPortrait,
  drawPortRing,
  drawPortTag,
  drawStockIcon,
  getCharacterRig,
  hexToRgb,
  mixHex,
  resolvePalette,
  shade,
  squashFor,
  withAlpha,
  type CharacterRig,
} from "./characterArt";
import { POSE_LIBRARY, samplePose } from "./poses";
import { BONE_NAMES, rigHeight } from "./skeleton";
import { makeDef, makeFighter } from "./testFixtures";

const ROSTER = ["mario", "donkeykong", "link", "samus", "kirby", "fox", "pikachu", "marth"] as const;

function rigOf(id: string): CharacterRig {
  return getCharacterRig(id);
}

/**
 * A rig's shape, reduced to four ratios.
 *
 * This is the closest a unit test can get to "does it read as the right
 * character": if two fighters' proportions are within a few percent on every
 * axis, they are the same silhouette wearing different colours, and no amount
 * of palette work will save them.
 */
function proportions(rig: CharacterRig): number[] {
  const b = rig.bones;
  const height = rigHeight(b, rig.headRadius);
  const legs = b.thighL.length + b.shinL.length;
  const arms = b.upperArmL.length + b.forearmL.length;
  return [
    height * rig.scale,
    rig.headRadius / height,
    arms / legs,
    b.torso.thickness / height,
  ];
}

describe("the roster's rigs", () => {
  it("has one for every fighter in the spec, plus aliases", () => {
    for (const id of ROSTER) expect(getCharacterRig(id).id).not.toBe("default");
    expect(getCharacterRig("dk")).toBe(getCharacterRig("donkeyKong"));
    expect(getCharacterRig("Donkey Kong")).toBe(getCharacterRig("donkeykong"));
    expect(getCharacterRig("donkey-kong")).toBe(getCharacterRig("donkeykong"));
  });

  it("falls back rather than throwing on an unknown or missing id", () => {
    expect(getCharacterRig("bowser").id).toBe("default");
    expect(getCharacterRig(null).id).toBe("default");
    expect(getCharacterRig(undefined).id).toBe("default");
  });

  it("gives every fighter a silhouette nobody else has", () => {
    const sigs = ROSTER.map((id) => ({ id, p: proportions(rigOf(id)) }));
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const a = sigs[i].p;
        const b = sigs[j].p;
        // At least one of the four ratios differs by 12% or more.
        const spread = a.map((v, k) => Math.abs(v - b[k]) / Math.max(Math.abs(v), Math.abs(b[k])));
        expect(
          Math.max(...spread),
          `${sigs[i].id} and ${sigs[j].id} are the same shape`,
        ).toBeGreaterThan(0.12);
      }
    }
  });

  it("puts Kirby and Pikachu on the round end and DK and Marth on the tall end", () => {
    const h = (id: string) => proportions(rigOf(id))[0];
    expect(h("kirby")).toBeLessThan(h("mario"));
    expect(h("pikachu")).toBeLessThan(h("mario"));
    expect(h("donkeykong")).toBeGreaterThan(h("mario"));
    expect(h("marth")).toBeGreaterThan(h("mario"));

    // Head-to-height ratio: the two little ones are mostly head.
    const headiness = (id: string) => proportions(rigOf(id))[1];
    expect(headiness("kirby")).toBeGreaterThan(headiness("mario") * 1.5);
    expect(headiness("pikachu")).toBeGreaterThan(headiness("mario") * 1.5);
  });

  it("gives Donkey Kong arms longer than his legs, and nobody else", () => {
    const ratio = (id: string) => proportions(rigOf(id))[2];
    expect(ratio("donkeykong")).toBeGreaterThan(1.3);
    for (const id of ROSTER) {
      if (id === "donkeykong") continue;
      expect(ratio(id), id).toBeLessThan(1.3);
    }
  });

  it("gives Samus one forearm markedly fatter than the other — the cannon arm", () => {
    const samus = rigOf("samus").bones;
    expect(samus.forearmR.thickness).toBeGreaterThan(samus.forearmL.thickness * 1.25);
    // And it is the only rig that is asymmetric this way.
    for (const id of ROSTER) {
      if (id === "samus") continue;
      const b = rigOf(id).bones;
      expect(b.forearmR.thickness, id).toBeCloseTo(b.forearmL.thickness, 6);
    }
  });

  it("separates every fighter at the outline — by a prop, or by being a sphere", () => {
    // Flat details sit inside the body and do nothing for a silhouette, so they
    // do not count toward the rule.
    const FLAT = new Set(["face", "cheeks", "visor", "patch", "brow", "moustache"]);
    const spherical: string[] = [];

    for (const id of ROSTER) {
      const rig = rigOf(id);
      const breaksOutline = rig.props.some((p) => !FLAT.has(p.kind));
      const headiness = proportions(rig)[1];
      if (!breaksOutline) {
        // The only permitted exemption: the fighter whose body *is* the
        // silhouette. Anything else without a prop is an unfinished character.
        expect(headiness, `${id} has no outline prop and is not a sphere`).toBeGreaterThan(0.4);
        spherical.push(id);
      }
    }
    expect(spherical).toEqual(["kirby"]);
  });

  it("attaches every prop to a bone that exists", () => {
    for (const rig of Object.values(CHARACTER_RIGS)) {
      for (const prop of rig.props) {
        expect(BONE_NAMES).toContain(prop.bone);
        expect(prop.size).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the signature props unique to their owners", () => {
    const owner = (kind: string) =>
      ROSTER.filter((id) => rigOf(id).props.some((p) => p.kind === kind));
    expect(owner("cannon")).toEqual(["samus"]);
    expect(owner("tie")).toEqual(["donkeykong"]);
    expect(owner("tailBolt")).toEqual(["pikachu"]);
    expect(owner("tailBushy")).toEqual(["fox"]);
    expect(owner("capPointed")).toEqual(["link"]);
    expect(owner("shield")).toEqual(["link"]);
    expect(owner("swordLong")).toEqual(["marth"]);
    expect(owner("tiara")).toEqual(["marth"]);
  });
});

describe("palettes", () => {
  it("returns the base palette for costume 0 and out-of-range costumes", () => {
    const def = makeDef();
    expect(resolvePalette(def, 0).primary).toBe("#E03A2C");
    expect(resolvePalette(def, 9).primary).toBe("#E03A2C");
  });

  it("remaps primary/secondary/accent for an alternate costume, keeping skin", () => {
    const def = makeDef();
    const alt = resolvePalette(def, 1);
    expect(alt.primary).toBe("#2C7A3A");
    expect(alt.skin).toBe(def.palette.skin);
    expect(alt.outline).toBe(def.palette.outline);
  });

  it("survives a missing definition", () => {
    expect(resolvePalette(null, 2).primary).toBeTruthy();
  });
});

describe("colour helpers", () => {
  it("parses three- and six-digit hex", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("AD0000")).toEqual([173, 0, 0]);
  });

  it("shades toward black and white", () => {
    expect(shade("#808080", -1)).toBe("#000000");
    expect(shade("#808080", 1)).toBe("#ffffff");
    expect(shade("#808080", 0)).toBe("#808080");
  });

  it("mixes and alphas", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(withAlpha("#FE3636", 0.5)).toBe("rgba(254, 54, 54, 0.5)");
    expect(withAlpha("#FE3636", 4)).toBe("rgba(254, 54, 54, 1)");
  });

  it("uses the sampled port colours from the spec", () => {
    expect(PORT_COLOURS).toEqual(["#FE3636", "#3B7BFE", "#FFC61E", "#35C759"]);
  });
});

describe("drawing a figure", () => {
  const transform = { x: 400, y: 700, scale: 8, facing: 1 };
  const palette = makeDef().palette;

  it("emits one capsule per drawn bone", () => {
    const ctx = createMockContext();
    drawFigure(ctx, { rig: rigOf("mario"), palette, pose: REST_SAMPLE, transform, mode: "body" });
    expect(countCapsules(ctx)).toBe(15);
  });

  it("draws Samus's cannon-arm rig with the same bone count as Mario's", () => {
    const a = createMockContext();
    const b = createMockContext();
    drawFigure(a, { rig: rigOf("mario"), palette, pose: REST_SAMPLE, transform, mode: "body" });
    drawFigure(b, { rig: rigOf("samus"), palette, pose: REST_SAMPLE, transform, mode: "body" });
    // Samus zeroes her right hand — one capsule fewer, everything else shared.
    expect(countCapsules(b)).toBe(countCapsules(a) - 1);
  });

  it("paints nothing but the outline colour in silhouette mode", () => {
    const ctx = createMockContext();
    const flatPalette = { ...palette, outline: "#000000" };
    drawFigure(ctx, {
      rig: rigOf("pikachu"),
      palette: flatPalette,
      pose: REST_SAMPLE,
      transform,
      mode: "silhouette",
    });
    const fills = assignmentsTo(ctx, "fillStyle").filter((v) => typeof v === "string");
    const strokes = assignmentsTo(ctx, "strokeStyle").filter((v) => typeof v === "string");
    for (const v of [...fills, ...strokes]) expect(v).toBe("#000000");
  });

  it("inflates the rim pass beyond the body pass", () => {
    const rimCtx = createMockContext();
    const bodyCtx = createMockContext();
    const common = { rig: rigOf("link"), palette, pose: REST_SAMPLE, transform } as const;
    drawFigure(rimCtx, { ...common, mode: "rim", rimWidth: 6 });
    drawFigure(bodyCtx, { ...common, mode: "body" });

    const widest = (c: ReturnType<typeof createMockContext>) =>
      Math.max(...(assignmentsTo(c, "lineWidth") as number[]));
    expect(widest(rimCtx)).toBeGreaterThan(widest(bodyCtx));
  });

  it("keeps the eyes out of the rim, so they never fatten the silhouette", () => {
    const rimCtx = createMockContext();
    const bodyCtx = createMockContext();
    const common = { rig: rigOf("mario"), palette, pose: REST_SAMPLE, transform } as const;
    drawFigure(rimCtx, { ...common, mode: "rim", rimWidth: 6 });
    drawFigure(bodyCtx, { ...common, mode: "body" });
    expect(countOf(bodyCtx, "ellipse")).toBeGreaterThan(countOf(rimCtx, "ellipse"));
  });

  it("mirrors props with the fighter", () => {
    const right = createMockContext();
    const left = createMockContext();
    const common = { rig: rigOf("link"), palette, pose: REST_SAMPLE, mode: "body" } as const;
    drawFigure(right, { ...common, transform });
    drawFigure(left, { ...common, transform: { ...transform, facing: -1 } });
    const scaleX = (c: ReturnType<typeof createMockContext>) =>
      c.calls.filter((k) => k.method === "scale").map((k) => k.args[0] as number);
    expect(scaleX(right).every((v) => v > 0)).toBe(true);
    expect(scaleX(left).some((v) => v < 0)).toBe(true);
  });

  it("draws every roster fighter in every pose without throwing or emitting NaN", () => {
    for (const id of ROSTER) {
      for (const name of Object.keys(POSE_LIBRARY) as (keyof typeof POSE_LIBRARY)[]) {
        const ctx = createMockContext();
        const pose = samplePose(POSE_LIBRARY[name], 0.4);
        drawFigure(ctx, { rig: rigOf(id), palette, pose, transform, mode: "body" });
        for (const call of ctx.calls) {
          for (const arg of call.args) {
            if (typeof arg === "number") {
              expect(Number.isFinite(arg), `${id}/${String(name)} emitted ${arg}`).toBe(true);
            }
          }
        }
      }
    }
  });

  /*
   * The hit flash, which shipped bleaching a third of the screen.
   *
   * It was a `source-atop` fill of an 800×800 rect centred on the head, on the
   * theory that `source-atop` would clip to "the fighter drawn just now".
   * Canvas 2D has no layer: it clipped to every non-transparent pixel already
   * on the canvas — sky, mountains, clouds, platforms — and painted a
   * hard-edged translucent rectangle across all of them. 178 render tests were
   * green at the time, because the only assertion anyone had written was that
   * the composite mode was *set*.
   *
   * So these assert the two things that were actually wrong: nothing gets
   * painted wider than the fighter, and no composite mode is used at all.
   */
  describe("the hit flash", () => {
    const flashRig = rigOf("fox");
    // Feet-to-crown in screen pixels at this transform — the fighter's own size.
    const figureHeight = rigHeight(flashRig.bones, flashRig.headRadius) * transform.scale;
    const tinted = { rig: flashRig, palette, pose: REST_SAMPLE, transform } as const;

    /** Axis-aligned fills, which is the only way to wash an area this large. */
    function areaFills(ctx: ReturnType<typeof createMockContext>): number[][] {
      return [...callsOf(ctx, "fillRect"), ...callsOf(ctx, "rect"), ...callsOf(ctx, "strokeRect")].map(
        (c) => c.args as number[],
      );
    }

    it("paints nothing larger than the fighter", () => {
      const ctx = createMockContext();
      drawFigure(ctx, { ...tinted, mode: "body", tint: { colour: "#FFFFFF", amount: 0.8 } });

      // A prop paints inside its own scaled frame, where one unit is the prop —
      // so this bounds screen-space and local-space fills alike, at 1.5× the
      // fighter. The rect that shipped was 800px on a 108px figure.
      for (const [, , w, h] of areaFills(ctx)) {
        expect(Math.abs(w), `a fill ${w}×${h} wide is bigger than the fighter`).toBeLessThan(figureHeight * 1.5);
        expect(Math.abs(h), `a fill ${w}×${h} tall is bigger than the fighter`).toBeLessThan(figureHeight * 1.5);
      }
    });

    it("never leaves a composite operation behind, and never needs one", () => {
      const ctx = createMockContext();
      drawFigure(ctx, { ...tinted, mode: "body", tint: { colour: "#FFFFFF", amount: 0.8 } });
      const modes = assignmentsTo(ctx, "globalCompositeOperation");
      expect(modes.filter((m) => m !== "source-over")).toEqual([]);
      expect(ctx.globalCompositeOperation).toBe("source-over");
    });

    it("repaints the fighter's own shapes flat, in the tint colour", () => {
      const plain = createMockContext();
      const flashed = createMockContext();
      drawFigure(plain, { ...tinted, mode: "body" });
      drawFigure(flashed, { ...tinted, mode: "body", tint: { colour: "#12EF34", amount: 0.5 } });

      // Every bone again, and only in the tint colour: a second flat pass.
      expect(countCapsules(flashed)).toBe(countCapsules(plain) * 2);
      const strokes = assignmentsTo(flashed, "strokeStyle").filter((v) => v === "#12EF34");
      expect(strokes.length).toBe(countCapsules(plain));
      expect(assignmentsTo(flashed, "fillStyle")).toContain("#12EF34");
      expect(assignmentsTo(plain, "fillStyle")).not.toContain("#12EF34");
    });

    it("scales the flash by the fighter's own alpha, and balances its save", () => {
      const ctx = createMockContext();
      drawFigure(ctx, { ...tinted, mode: "body", alpha: 0.5, tint: { colour: "#FFFFFF", amount: 0.8 } });
      expect(assignmentsTo(ctx, "globalAlpha")).toContain(0.4);
      expect(countOf(ctx, "save")).toBe(countOf(ctx, "restore"));
    });

    it("does not tint the rim pass", () => {
      const rim = createMockContext();
      const plain = createMockContext();
      drawFigure(rim, { ...tinted, mode: "rim", rimWidth: 6, tint: { colour: "#12EF34", amount: 0.8 } });
      drawFigure(plain, { ...tinted, mode: "rim", rimWidth: 6 });
      expect(assignmentsTo(rim, "strokeStyle")).not.toContain("#12EF34");
      expect(countCapsules(rim)).toBe(countCapsules(plain));
    });

    it("skips the flash entirely at zero", () => {
      const off = createMockContext();
      const plain = createMockContext();
      drawFigure(off, { ...tinted, mode: "body", tint: { colour: "#FFFFFF", amount: 0 } });
      drawFigure(plain, { ...tinted, mode: "body" });
      expect(off.calls.length).toBe(plain.calls.length);
    });
  });
});

describe("squash and stretch", () => {
  it("squashes hardest on the first landing frame and relaxes", () => {
    const f0 = squashFor(makeFighter({ action: "land", actionFrame: 0 }));
    const f4 = squashFor(makeFighter({ action: "land", actionFrame: 4 }));
    expect(f0.scaleX).toBeGreaterThan(f4.scaleX);
    expect(f0.scaleY).toBeLessThan(f4.scaleY);
    expect(f0.scaleX).toBeGreaterThan(1);
    expect(f0.scaleY).toBeLessThan(1);
  });

  it("stretches during hitlag, the other way from a landing", () => {
    const s = squashFor(makeFighter({ hitlag: 8 }));
    expect(s.scaleX).toBeLessThan(1);
    expect(s.scaleY).toBeGreaterThan(1);
  });

  it("is neutral in every other state", () => {
    expect(squashFor(makeFighter({ action: "stand" }))).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it("roughly preserves volume, so nobody gains mass on landing", () => {
    for (const f of [
      makeFighter({ action: "land", actionFrame: 0 }),
      makeFighter({ hitlag: 8 }),
      makeFighter({ action: "jumpSquat" }),
    ]) {
      const s = squashFor(f);
      expect(s.scaleX * s.scaleY).toBeGreaterThan(0.92);
      expect(s.scaleX * s.scaleY).toBeLessThan(1.08);
    }
  });
});

describe("port furniture", () => {
  it("rings the feet in the port colour", () => {
    const ctx = createMockContext();
    drawPortRing(ctx, 100, 200, 40, 1);
    expect(assignmentsTo(ctx, "strokeStyle").some((v) => String(v).includes("59, 123, 254"))).toBe(true);
  });

  it("labels a player and a CPU differently", () => {
    const a = createMockContext();
    const b = createMockContext();
    drawPortTag(a, 0, 0, 0, "P1");
    drawPortTag(b, 0, 0, 0, "CPU");
    expect(a.calls.find((c) => c.method === "fillText")?.args[0]).toBe("P1");
    expect(b.calls.find((c) => c.method === "fillText")?.args[0]).toBe("CPU");
  });

  it("draws portraits and stock icons from the same rig as the match", () => {
    const portrait = createMockContext();
    const stock = createMockContext();
    drawHeadPortrait(portrait, rigOf("kirby"), makeDef().palette, 100, 100, 80);
    drawStockIcon(stock, rigOf("kirby"), 100, 100, 30, "#FE3636");
    expect(countCapsules(portrait)).toBeGreaterThan(0);
    expect(countCapsules(stock)).toBe(15);
    // A stock icon is flat: one colour, no palette.
    const fills = new Set(assignmentsTo(stock, "fillStyle").map(String));
    expect(fills.size).toBe(1);
  });
});
