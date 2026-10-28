import { describe, expect, it } from "vitest";

import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { getFighter } from "@/fighters";
import { makeFighter } from "../testFixtures";
import { actionDurationFor, jumpTimingFor } from "./timing";

describe("the jump clip's length comes from the engine's jump rule", () => {
  const fox = getFighter("fox")!;
  const kirby = getFighter("kirby")!;

  it("is the number of rising frames, for each kind of jump", () => {
    const p = fighterParams(fox);
    const t = jumpTimingFor(fox);
    expect(t.full).toBe(jumpRiseSpeeds(p, "full").length);
    expect(t.short).toBe(jumpRiseSpeeds(p, "short").length);
    expect(t.air[0]).toBe(jumpRiseSpeeds(p, "air", 0).length);
    const jump = (over: object) => makeFighter({ action: "jump", actionFrame: 0, ...over });
    expect(actionDurationFor(jump({ jumpsUsed: 1, shortHop: false }), t)).toBe(t.full);
    expect(actionDurationFor(jump({ jumpsUsed: 1, shortHop: true }), t)).toBe(t.short);
    expect(actionDurationFor(jump({ jumpsUsed: 2 }), t)).toBe(t.air[0]);
  });

  it("gives each of Kirby's midair jumps its own, shorter rise", () => {
    const t = jumpTimingFor(kirby);
    expect(t.air).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(t.air[i]).toBeLessThan(t.air[i - 1]);
    const fifth = makeFighter({ action: "jump", actionFrame: 0, jumpsUsed: 6 });
    expect(actionDurationFor(fifth, t)).toBe(t.air[4]);
  });

  it("is cached per fighter definition", () => {
    expect(jumpTimingFor(fox)).toBe(jumpTimingFor(fox));
  });
});
