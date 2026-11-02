/**
 * Kill credit on the results screen (`killCredit.ts`), and a push's share of
 * it (Plan 5, Task 6 fix round 1). SmashWiki "Windbox"
 * (https://www.ssbwiki.com/Windbox): "if a player is hit with a non-damaging
 * windbox by an opponent, and then promptly SDs, it will count as a KO for the
 * opponent".
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn, emptyEvents } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { KILL_CREDIT_FRAMES, createTracker, trackFrame } from "./killCredit";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

const ko = (port: number): StepEvents["kos"][number] => ({ port, x: 0, y: 0, kind: "blast" });
const events = (over: Partial<StepEvents>): StepEvents => ({ ...emptyEvents(), ...over });

describe("kill credit", () => {
  it("gives a KO to whoever last hit the fighter, inside the window, and an SD otherwise", () => {
    const t = createTracker(2);
    trackFrame(t, 10, events({ hits: [{ attacker: 0, victim: 1, damage: 0, x: 0, y: 0, contactX: 0, contactY: 0, knockback: 0, angle: 0, hitboxId: 0 }] }));
    trackFrame(t, 10 + KILL_CREDIT_FRAMES, events({ kos: [ko(1)] }));
    expect(t).toMatchObject({ kos: [1, 0], falls: [0, 1], sds: [0, 0] });
    trackFrame(t, 400, events({ kos: [ko(1)] }));
    expect(t).toMatchObject({ kos: [1, 0], falls: [0, 2], sds: [0, 1] });
  });

  it("counts a push as a hit (SmashWiki \"Windbox\")", () => {
    const t = createTracker(2);
    trackFrame(t, 50, events({ pushes: [{ attacker: 0, victim: 1 }] }));
    trackFrame(t, 50 + KILL_CREDIT_FRAMES, events({ kos: [ko(1)] }));
    expect(t).toMatchObject({ kos: [1, 0], falls: [0, 1], sds: [0, 0] });
    // ...and not one past the window.
    trackFrame(t, 300, events({ pushes: [{ attacker: 0, victim: 1 }] }));
    trackFrame(t, 301 + KILL_CREDIT_FRAMES, events({ kos: [ko(1)] }));
    expect(t).toMatchObject({ kos: [1, 0], falls: [0, 2], sds: [0, 1] });
  });

  // The Task 6 re-review's X11: a fighter's own hit or push (a bomb jump's) is no
  // one else's, and does not wipe out the opponent who last touched it.
  it("never credits a fighter with its own KO: its own hit or push leaves the last opponent's touch", () => {
    const t = createTracker(2);
    const self = { attacker: 1, victim: 1, damage: 0, x: 0, y: 0, contactX: 0, contactY: 0, knockback: 0, angle: 0, hitboxId: 0 };
    trackFrame(t, 10, events({ hits: [{ ...self, attacker: 0 }] }));
    trackFrame(t, 20, events({ hits: [self], pushes: [{ attacker: 1, victim: 1 }] }));
    trackFrame(t, 30, events({ kos: [ko(1)] }));
    expect(t).toMatchObject({ kos: [1, 0], falls: [0, 1], sds: [0, 0] });
    // With nobody else's touch, its own makes it a self-destruct.
    trackFrame(t, 40, events({ hits: [self], pushes: [{ attacker: 1, victim: 1 }] }));
    trackFrame(t, 50, events({ kos: [ko(1)] }));
    expect(t).toMatchObject({ kos: [1, 0], falls: [0, 2], sds: [0, 1] });
  });

  it("counts a footstool as a hit (SmashWiki \"Footstool Jump\": \"it will count as a KO for the footstooling player\")", () => {
    const t = createTracker(2);
    trackFrame(t, 50, events({ footstools: [{ jumper: 0, victim: 1 }] }));
    trackFrame(t, 50 + KILL_CREDIT_FRAMES, events({ kos: [ko(1)] }));
    expect(t).toMatchObject({ kos: [1, 0], falls: [0, 1], sds: [0, 0] });
  });

  it("credits Mario when F.L.U.D.D. pushes a recovering Fox out, with no hit at all", () => {
    // Mario at the edge; Fox helpless off it, falling past into the water.
    const play = (fire: boolean) => {
      const s: GameState = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
      Object.assign(s.fighters[0], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(70), y: 0, facing: 1, intangible: 0 });
      Object.assign(s.fighters[1], { action: "specialFall", actionFrame: 0, grounded: false, platform: -1, x: fx(92), y: fx(44), facing: -1, intangible: 0, jumpsUsed: 2 });
      s.fighters[1].combat.helplessMove = "upB";
      const t = createTracker(2);
      let state = s;
      let prev: [InputFrame, InputFrame] = [0, 0];
      let hits = 0;
      let pushes = 0;
      for (let i = 0; i < 240 && t.falls[1] === 0; i++) {
        const now: [InputFrame, InputFrame] = [fire && (i === 0 || i === 15) ? Btn.Down | Btn.Special : 0, 0];
        const out = step(state, now, { prevInputs: prev });
        state = out.state;
        prev = now;
        hits += out.events.hits.length;
        pushes += out.events.pushes.length;
        trackFrame(t, state.frame, out.events);
      }
      return { t, hits, pushes };
    };
    const pushed = play(true);
    expect(pushed.hits).toBe(0);
    expect(pushed.pushes).toBeGreaterThan(0);
    expect(pushed.t).toMatchObject({ kos: [1, 0], falls: [0, 1], sds: [0, 0] });
    // Left alone, the same fall is his own self-destruct.
    expect(play(false).t).toMatchObject({ kos: [0, 0], falls: [0, 1], sds: [0, 1] });
  });
});
