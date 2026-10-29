/**
 * The pose clock's state lengths (`statusDuration`, `engine/acmd/poseClock.ts`)
 * are the 2D renderer's (`actionDurationFor`), case for case, for every fighter
 * on the roster: the bake and both renderers time a state by one number.
 *
 * The engine cannot import this layer (`layering.test.ts`), so the check lives
 * here, on the render side.
 */

import { describe, expect, it } from "vitest";

import { statusDuration } from "@/engine/acmd/poseClock";
import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { STATUS_KIND_OF_ACTION } from "@/engine/status/kind";
import type { ActionState, FighterState } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { makeFighter } from "../testFixtures";
import { actionDurationFor, jumpTimingFor } from "./timing";

const ACTIONS = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];

describe("the pose clock's state lengths are the 2D renderer's", () => {
  it.each(FIGHTERS.map((d) => [d.id, d] as const))("%s: every action, every branch", (_id, def) => {
    const jump = jumpTimingFor(def);
    const ledge = jumpRiseSpeeds(fighterParams(def), "ledge");
    const mismatches: string[] = [];
    let checked = 0;
    for (const action of ACTIONS)
      for (const actionFrame of [0, 3, 11])
        for (const charge of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15])
          for (const hitstun of [0, 13])
            for (const jumpsUsed of [1, 2, 3, 6])
              for (const shortHop of [false, true])
                for (const vy of [0, ledge[actionFrame]]) {
                  const f: FighterState = makeFighter({ defId: def.id, action, actionFrame, charge, hitstun, jumpsUsed, shortHop, vy });
                  const engine = statusDuration(f, def);
                  const drawn = actionDurationFor(f, jump);
                  checked++;
                  if (engine !== drawn) {
                    mismatches.push(`${action} frame ${actionFrame} charge ${charge} hitstun ${hitstun} jumps ${jumpsUsed} short ${shortHop} vy ${vy}: ${engine} vs ${drawn}`);
                  }
                }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(checked).toBe(ACTIONS.length * 3 * 11 * 2 * 4 * 2 * 2);
  });
});
