/**
 * Stage data tests.
 *
 * These check the properties that make a stage *playable* rather than merely
 * well-typed: a ledge outside the blast zone would kill anyone who grabbed it,
 * a spawn below the floor would drop all four players on frame one, and a form
 * transform that kept the wrong half of the stage would silently give every
 * Ω match Battlefield's ceiling.
 */

import { describe, expect, it } from "vitest";
import { toFloat } from "@/engine/fixed";
import type { StageDef } from "@/engine/types";
import {
  STAGES,
  allStageForms,
  battlefield,
  battlefieldForm,
  finalDestination,
  getStage,
  omegaForm,
  resolveStage,
  stageForm,
} from "./index";

/** The main platform is the one with grabbable ledges. Every stage has exactly one. */
function mainPlatform(stage: StageDef) {
  const withLedges = stage.platforms.filter((p) => p.ledges);
  expect(withLedges).toHaveLength(1);
  return withLedges[0];
}

describe("the registry", () => {
  it("holds six stages", () => {
    expect(STAGES).toHaveLength(6);
  });

  it("resolves every stage by its id", () => {
    for (const stage of STAGES) {
      expect(getStage(stage.id)).toBe(stage);
    }
  });

  it("gives every stage a unique id", () => {
    const ids = STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns undefined for an id nobody defined", () => {
    expect(getStage("hyrule-temple")).toBeUndefined();
    expect(resolveStage("hyrule-temple-omega")).toBeUndefined();
  });
});

describe("geometry", () => {
  it.each(STAGES.map((s) => [s.name, s] as const))("%s has a sane blast zone", (_name, stage) => {
    const { left, right, top, bottom } = stage.blastZone;
    expect(left).toBeLessThan(right);
    expect(bottom).toBeLessThan(top);
  });

  it.each(STAGES.map((s) => [s.name, s] as const))(
    "%s keeps both ledges inside the blast zone",
    (_name, stage) => {
      const main = mainPlatform(stage);
      const leftLedge = main.x - main.halfWidth;
      const rightLedge = main.x + main.halfWidth;

      expect(leftLedge).toBeGreaterThan(stage.blastZone.left);
      expect(rightLedge).toBeLessThan(stage.blastZone.right);
      // A ledge below the lower blast zone would be unreachable, not just odd.
      expect(main.y).toBeGreaterThan(stage.blastZone.bottom);
      expect(main.y).toBeLessThan(stage.blastZone.top);
    }
  );

  it.each(STAGES.map((s) => [s.name, s] as const))(
    "%s puts every platform inside the blast zone",
    (_name, stage) => {
      for (const p of stage.platforms) {
        expect(p.x - p.halfWidth).toBeGreaterThan(stage.blastZone.left);
        expect(p.x + p.halfWidth).toBeLessThan(stage.blastZone.right);
        expect(p.y).toBeLessThan(stage.blastZone.top);
        expect(p.y).toBeGreaterThan(stage.blastZone.bottom);
      }
    }
  );

  it.each(STAGES.map((s) => [s.name, s] as const))(
    "%s gives soft platforms no ledges, and the main platform ledges",
    (_name, stage) => {
      const main = mainPlatform(stage);
      expect(main.soft).toBe(false);
      for (const p of stage.platforms) {
        if (p.soft) expect(p.ledges).toBe(false);
      }
    }
  );

  it.each(STAGES.map((s) => [s.name, s] as const))(
    "%s gives every platform a positive half-width",
    (_name, stage) => {
      for (const p of stage.platforms) expect(p.halfWidth).toBeGreaterThan(0);
    }
  );
});

describe("spawn points", () => {
  it.each(STAGES.map((s) => [s.name, s] as const))("%s spawns four players", (_name, stage) => {
    expect(stage.spawns).toHaveLength(4);
  });

  it.each(STAGES.map((s) => [s.name, s] as const))(
    "%s stands every player on top of a platform",
    (_name, stage) => {
      for (const spawn of stage.spawns) {
        // A spawn must sit at or above the surface of some platform whose span
        // contains it — otherwise the player begins the match inside the stage.
        const supporting = stage.platforms.filter(
          (p) =>
            spawn.x >= p.x - p.halfWidth && spawn.x <= p.x + p.halfWidth && spawn.y >= p.y
        );
        expect(
          supporting.length,
          `spawn at (${toFloat(spawn.x)}, ${toFloat(spawn.y)}) on ${stage.name} has nothing under it`
        ).toBeGreaterThan(0);
      }
    }
  );

  it.each(STAGES.map((s) => [s.name, s] as const))(
    "%s spawns everyone inside the blast zone",
    (_name, stage) => {
      for (const spawn of stage.spawns) {
        expect(spawn.x).toBeGreaterThan(stage.blastZone.left);
        expect(spawn.x).toBeLessThan(stage.blastZone.right);
        expect(spawn.y).toBeGreaterThan(stage.blastZone.bottom);
        expect(spawn.y).toBeLessThan(stage.blastZone.top);
      }
    }
  );
});

describe("the form transforms", () => {
  it.each(STAGES.map((s) => [s.name, s] as const))(
    "%s's Omega form keeps the skin and takes Final Destination's geometry",
    (_name, stage) => {
      const omega = omegaForm(stage);

      // skin preserved
      expect(omega.name).toBe(stage.name);
      expect(omega.series).toBe(stage.series);
      expect(omega.theme).toBe(stage.theme);
      expect(omega.id).toBe(`${stage.id}-omega`);

      // geometry replaced
      expect(omega.platforms).toEqual(finalDestination.platforms);
      expect(omega.blastZone).toEqual(finalDestination.blastZone);
      expect(omega.spawns).toEqual(finalDestination.spawns);
      expect(omega.platforms.filter((p) => p.soft)).toHaveLength(0);
    }
  );

  it.each(STAGES.map((s) => [s.name, s] as const))(
    "%s's Battlefield form keeps the skin and takes Battlefield's geometry",
    (_name, stage) => {
      const bf = battlefieldForm(stage);

      expect(bf.name).toBe(stage.name);
      expect(bf.series).toBe(stage.series);
      expect(bf.theme).toBe(stage.theme);
      expect(bf.id).toBe(`${stage.id}-battlefield`);

      expect(bf.platforms).toEqual(battlefield.platforms);
      expect(bf.blastZone).toEqual(battlefield.blastZone);
      expect(bf.spawns).toEqual(battlefield.spawns);
      expect(bf.platforms.filter((p) => p.soft)).toHaveLength(3);
    }
  );

  it("makes all six Battlefield forms geometrically identical, as Ultimate guarantees", () => {
    const forms = STAGES.map(battlefieldForm);
    for (const f of forms) {
      expect(f.platforms).toEqual(forms[0].platforms);
      expect(f.blastZone).toEqual(forms[0].blastZone);
    }
    // ...and still tell six stages apart.
    expect(new Set(forms.map((f) => f.theme)).size).toBe(new Set(STAGES.map((s) => s.theme)).size);
  });

  it("makes all six Omega forms geometrically identical", () => {
    const forms = STAGES.map(omegaForm);
    for (const f of forms) {
      expect(f.platforms).toEqual(forms[0].platforms);
      expect(f.blastZone).toEqual(forms[0].blastZone);
    }
  });

  it("treats Battlefield's own Battlefield form as an identity on geometry", () => {
    const bf = battlefieldForm(battlefield);
    expect(bf.platforms).toEqual(battlefield.platforms);
    expect(bf.blastZone).toEqual(battlefield.blastZone);
  });

  it("treats Final Destination's own Omega form as an identity on geometry", () => {
    const omega = omegaForm(finalDestination);
    expect(omega.platforms).toEqual(finalDestination.platforms);
    expect(omega.blastZone).toEqual(finalDestination.blastZone);
  });

  it("leaves a normal form completely alone", () => {
    for (const stage of STAGES) {
      expect(stageForm(stage, "normal")).toBe(stage);
    }
  });

  it("round-trips a form id back to the same geometry", () => {
    for (const stage of STAGES) {
      const omega = resolveStage(`${stage.id}-omega`);
      expect(omega).toBeDefined();
      expect(omega!.platforms).toEqual(finalDestination.platforms);
      expect(omega!.theme).toBe(stage.theme);

      const bf = resolveStage(`${stage.id}-battlefield`);
      expect(bf).toBeDefined();
      expect(bf!.platforms).toEqual(battlefield.platforms);
      expect(bf!.theme).toBe(stage.theme);
    }
  });

  it("enumerates eighteen playable forms with unique ids", () => {
    const forms = allStageForms();
    expect(forms).toHaveLength(18);
    expect(new Set(forms.map((f) => f.id)).size).toBe(18);
  });

  it("keeps every transformed form's spawns standing on its borrowed geometry", () => {
    for (const form of allStageForms()) {
      for (const spawn of form.spawns) {
        const supporting = form.platforms.filter(
          (p) => spawn.x >= p.x - p.halfWidth && spawn.x <= p.x + p.halfWidth && spawn.y >= p.y
        );
        expect(supporting.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the stages the brief specified", () => {
  // Guards the six rows of SPEC §8 against a well-meaning edit.
  const EXPECTED: Record<string, [number, number, number, number, number, number]> = {
    //                    blastL  blastR  blastT  blastB  ledgeL   ledgeR
    battlefield: [-240, 240, 192, -140, -79.99, 79.99],
    finalDestination: [-240, 240, 180, -140, -80, 79.99],
    smallBattlefield: [-240, 240, 180, -140, -80, 80],
    smashville: [-229, 230, 190, -115, -69.05, 70.25],
    townAndCity: [-230, 230, 195, -118, -81.78, 83.22],
    pokemonStadium2: [-250, 250, 180, -125, -93.78, 93.78],
  };

  it.each(Object.entries(EXPECTED))("%s matches Kurogane Hammer", (id, expected) => {
    const stage = getStage(id)!;
    expect(stage).toBeDefined();
    const main = mainPlatform(stage);
    const [bl, br, bt, bb, ll, lr] = expected;

    expect(toFloat(stage.blastZone.left)).toBeCloseTo(bl, 2);
    expect(toFloat(stage.blastZone.right)).toBeCloseTo(br, 2);
    expect(toFloat(stage.blastZone.top)).toBeCloseTo(bt, 2);
    expect(toFloat(stage.blastZone.bottom)).toBeCloseTo(bb, 2);
    expect(toFloat(main.x - main.halfWidth)).toBeCloseTo(ll, 2);
    expect(toFloat(main.x + main.halfWidth)).toBeCloseTo(lr, 2);
  });

  it("gives each stage the soft-platform count the spec calls for", () => {
    const softCount = (id: string) => getStage(id)!.platforms.filter((p) => p.soft).length;
    expect(softCount("battlefield")).toBe(3);
    expect(softCount("finalDestination")).toBe(0);
    expect(softCount("smallBattlefield")).toBe(2);
    expect(softCount("smashville")).toBe(1);
    expect(softCount("townAndCity")).toBe(3);
    expect(softCount("pokemonStadium2")).toBe(2);
  });

  it("gives Smashville the only moving platform", () => {
    for (const stage of STAGES) {
      const moving = stage.platforms.filter((p) => p.motion);
      expect(moving).toHaveLength(stage.id === "smashville" ? 1 : 0);
    }
    const sweep = getStage("smashville")!.platforms.find((p) => p.motion)!.motion!;
    expect(sweep.kind).toBe("sweep");
    expect(sweep.amplitude).toBeGreaterThan(0);
    expect(sweep.periodFrames).toBeGreaterThan(0);
  });

  it("arranges Battlefield's three platforms as a triangle", () => {
    const soft = battlefield.platforms.filter((p) => p.soft);
    const [left, top, right] = soft;
    // two low flanking, one high centre
    expect(left.y).toBe(right.y);
    expect(top.y).toBeGreaterThan(left.y);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(top.x).toBe(0);
    // and the flanking pair is symmetric
    expect(left.x).toBe(-right.x);
  });

  it("removes exactly Battlefield's top platform to make Small Battlefield", () => {
    const small = getStage("smallBattlefield")!.platforms.filter((p) => p.soft);
    const big = battlefield.platforms.filter((p) => p.soft);
    expect(small).toHaveLength(big.length - 1);
    // the survivors keep Battlefield's height and width
    for (const p of small) {
      expect(p.y).toBe(big[0].y);
      expect(p.halfWidth).toBe(big[0].halfWidth);
    }
  });
});
