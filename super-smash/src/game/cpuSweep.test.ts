// @vitest-environment node
/**
 * The CPU sweep (Plan 6, Tasks 23-27). The full measure is opt-in:
 * `CPU_SWEEP=1 pnpm vitest run src/game/cpuSweep.test.ts --reporter=verbose` prints the figures a
 * CPU task reports in its commit (`--reporter=verbose`: vitest 4's default reporter drops a passing
 * test's output when it goes to a file); `pnpm test` skips it. A short run stays in the suite, so
 * the harness itself keeps working.
 */

import { describe, expect, it } from "vitest";

import { stageViewFromDef } from "@/ai/behaviours";
import { findProjectileDef, markProjectileHit, spawnProjectile } from "@/engine/projectile";
import { cloneState, createInitialState } from "@/engine/simulate";
import { emptyEvents, type GameState, type StepEvents } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { countMatch, emptySweepStats, sweep, type SweepStats } from "./cpuSweep";

const IDS = FIGHTERS.map((f) => f.id);
const PAIRS = IDS.flatMap((a) => IDS.filter((b) => b !== a).map((b) => [a, b] as const));
/** The sweep's seeds: 1-6 (2,016 matches), or `CPU_SWEEP_SEEDS`, comma-separated, for one half of them. */
const SEEDS = (process.env.CPU_SWEEP_SEEDS ?? "1,2,3,4,5,6").split(",").map(Number);

describe("the CPU sweep's harness", () => {
  it("plays a short match to its end and counts it", () => {
    const stats = sweep({ pairs: [["mario", "fox"]], stages: ["battlefield"], seeds: [1], frames: 240, ball: false, level: 9 });
    expect(stats.matches).toBe(1);
    expect(stats.longestStandby).toBe(0);
    expect(stats.holds).toEqual({});
  }, 60_000);
});

/**
 * Constructed steps for each counting rule the CPU tasks are judged by (Task 23 fix round 1):
 * Mario (port 0) against Fox (port 1) on Battlefield, each frame a copy of the last with the
 * fields the rule reads set by hand.
 */
describe("the CPU sweep's counting rules", () => {
  const fighter = (id: string) => FIGHTERS.find((f) => f.id === id)!;
  const stage = (id: string) => STAGES.find((st) => st.id === id)!;
  const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: true, oneOnOne: true } as const;

  function match(): { stats: SweepStats; s: GameState; play: (edit: (s: GameState) => void, events?: Partial<StepEvents>) => void; end: () => void } {
    const stats = emptySweepStats();
    const start = createInitialState("battlefield", [{ defId: "mario" }, { defId: "fox" }], rules, 1, { fighter, stage });
    const counter = countMatch(stats, start, stageViewFromDef(stage("battlefield")), fighter);
    let s = start;
    let frame = 0;
    return {
      stats,
      get s() {
        return s;
      },
      play(edit, events = {}) {
        const before = s;
        s = cloneState(s);
        edit(s);
        frame += 1;
        counter.observe(frame, before, s, { ...emptyEvents(), ...events }, s.fighters.map(() => "idle"));
      },
      end() {
        counter.close(s);
      },
    };
  }

  const hit = (attacker: number, victim: number): StepEvents["hits"][number] => ({
    attacker,
    victim,
    damage: 0,
    x: 0,
    y: 0,
    contactX: 0,
    contactY: 0,
    knockback: 0,
    angle: 0,
    hitboxId: 0,
  });
  const ko = (port: number): StepEvents["kos"][number] => ({ port, x: 0, y: 0, kind: "blast" });
  const inFinal = (s: GameState) => {
    s.fighters[0].action = "special";
    s.fighters[0].move = "finalSmash";
  };
  const done = (s: GameState) => {
    s.fighters[0].action = "fall";
    s.fighters[0].move = null;
  };
  const flame = (s: GameState) => spawnProjectile(findProjectileDef(fighter("mario"), "hugeFlame")!, s.fighters[0], 1);

  it("credits a Final Smash its flames land after its user's move has ended", () => {
    const m = match();
    m.play((s) => {
      inFinal(s);
      s.projectiles.push(flame(s));
    });
    m.play(done);
    m.play(
      (s) => markProjectileHit(s.projectiles[0], 1, s.projectiles[0].age + 7),
      { hits: [hit(0, 1)] },
    );
    m.play((s) => {
      s.projectiles.length = 0;
    });
    expect(m.stats.finalSmashes.mario).toEqual({ fired: 1, landed: 1 });
  });

  it("does not credit a Final Smash with its user's own hit while its flames are out", () => {
    const m = match();
    m.play((s) => {
      inFinal(s);
      s.projectiles.push(flame(s));
    });
    m.play(done);
    m.play(() => {}, { hits: [hit(0, 1)] });
    m.play((s) => {
      s.projectiles.length = 0;
    });
    expect(m.stats.finalSmashes.mario).toEqual({ fired: 1, landed: 0 });
  });

  it("tallies a Final Smash that has landed and is still running when the match stops", () => {
    const m = match();
    m.play(inFinal);
    m.play(() => {}, { hits: [hit(0, 1)] });
    m.end();
    expect(m.stats.finalSmashes.mario).toEqual({ fired: 1, landed: 1 });
  });

  it("counts a KO after a shield break as somebody's, not a self-destruct", () => {
    const m = match();
    m.play((s) => {
      s.fighters[1].grounded = true;
      s.fighters[1].action = "shield";
    });
    m.play(
      (s) => {
        s.fighters[1].action = "shieldBroken";
        s.fighters[1].grounded = false;
      },
      { shieldHits: [{ victim: 1, x: 0, y: 0, contactX: 0, contactY: 0 }], shieldBreaks: [1] },
    );
    m.play(() => {}, { kos: [ko(1)] });
    expect(m.stats.selfDestructs).toBe(0);
  });

  it("counts a KO after a footstool as somebody's, not a self-destruct", () => {
    const m = match();
    m.play((s) => {
      s.fighters[1].grounded = true;
      s.fighters[1].action = "stand";
    });
    m.play(
      (s) => {
        s.fighters[1].action = "fall";
        s.fighters[1].grounded = false;
      },
      { footstools: [{ jumper: 0, victim: 1 }] },
    );
    m.play(() => {}, { kos: [ko(1)] });
    expect(m.stats.selfDestructs).toBe(0);
  });

  it("counts a KO with no hit since the fighter stood, and none after a hit, as before", () => {
    const m = match();
    m.play((s) => {
      s.fighters[1].grounded = true;
      s.fighters[1].action = "stand";
    });
    m.play((s) => {
      s.fighters[1].grounded = false;
      s.fighters[1].action = "fall";
    });
    m.play(() => {}, { kos: [ko(1)] });
    expect(m.stats.selfDestructs).toBe(1);
    m.play((s) => {
      s.fighters[0].grounded = true;
      s.fighters[0].action = "stand";
    });
    m.play((s) => {
      s.fighters[0].grounded = false;
      s.fighters[0].action = "tumble";
    }, { hits: [hit(1, 0)] });
    m.play(() => {}, { kos: [ko(0)] });
    expect(m.stats.selfDestructs).toBe(1);
  });

  it("counts a new stock's fall off its respawn platform without landing as a self-destruct", () => {
    const m = match();
    m.play((s) => {
      s.fighters[1].grounded = false;
      s.fighters[1].action = "tumble";
    }, { hits: [hit(0, 1)] });
    m.play(() => {}, { kos: [ko(1)] });
    expect(m.stats.selfDestructs).toBe(0);
    m.play((s) => {
      s.fighters[1].action = "respawnPlatform";
    });
    m.play((s) => {
      s.fighters[1].action = "fall";
    });
    m.play(() => {}, { kos: [ko(1)] });
    expect(m.stats.selfDestructs).toBe(1);
  });
});

describe.skipIf(process.env.CPU_SWEEP !== "1")("the CPU sweep (opt-in)", () => {
  it("measures the 56 ordered pairs on the six stages, the Smash Ball on, each seed", () => {
    const stats = sweep({ pairs: PAIRS, stages: STAGES.map((s) => s.id), seeds: SEEDS, frames: 3_600, ball: true, level: 9 });
    console.log(JSON.stringify(stats, null, 2));
    // Ruling R-P6-19's figures, one line a fighter: landed, and the mean hold.
    for (const id of IDS) {
      const f = stats.finalSmashes[id] ?? { fired: 0, landed: 0 };
      const h = stats.holds[id] ?? { holds: 0, frames: 0 };
      console.log(`${id}: fired ${f.fired}, landed ${f.landed}, holds ${h.holds}, mean hold ${h.holds === 0 ? 0 : Math.round(h.frames / h.holds)} frames`);
    }
    expect(stats.matches).toBe(PAIRS.length * STAGES.length * SEEDS.length);
  }, 3_600_000);
});
