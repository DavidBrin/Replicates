/**
 * An opt-in measure of the CPU across many matches (Plan 6, Tasks 23-27): the figures a CPU
 * task reports and no unit test can hold. `CPU_SWEEP=1 pnpm vitest run src/game/cpuSweep.test.ts --reporter=verbose > <log> 2>&1`.
 * Level-`level` CPUs on every port, the game's baked context, the worlds the game builds
 * (`cpuWorldFromDef`).
 *
 * Every figure is counted here from state every commit has (no field a later task adds), so the
 * one harness measures Task 23's baseline and each later CPU task the same way.
 *
 * Test support: nothing in the app imports it.
 */

import { cpuWorldFromDef, decideCpu, type CpuWorld } from "@/ai/cpu";
import { isStunned, stageViewFromDef } from "@/ai/behaviours";
import { isFinalSlot } from "@/engine/final";
import { createInitialState, step } from "@/engine/simulate";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

/** Dash attacks in a row that hit nobody, from which a run counts as a whiff run. */
export const DASH_WHIFF_RUN = 8;

export interface SweepOptions {
  readonly pairs: readonly (readonly [string, string])[];
  readonly stages: readonly string[];
  readonly seeds: readonly number[];
  readonly frames: number;
  readonly ball: boolean;
  readonly level: number;
}

export interface SweepStats {
  matches: number;
  /** By fighter: Final Smashes a CPU started, and how many hit or trapped somebody. */
  finalSmashes: Record<string, { fired: number; landed: number }>;
  /** The longest a CPU held the Smash Ball's power, in frames (`finalSmashReady` above 0, counted here). */
  longestStandby: number;
  /** By fighter: each hold of the Smash Ball's power (ended by spending it, losing it, or the match's end) and their frames summed; the mean hold is `frames / holds` (ruling R-P6-19). */
  holds: Record<string, { holds: number; frames: number }>;
  /** Kong Karry lifts by a CPU Donkey Kong. */
  kongKarry: number;
  /** By fighter: dash attacks started, and runs of `DASH_WHIFF_RUN` or more in a row that hit nobody. */
  dashAttacks: Record<string, { thrown: number; whiffRuns: number }>;
  /** KOs of a fighter that had stood on a floor on its own (or begun the match) since the last hit it took: off the stage on its own. Standing in a hit's hitlag or hitstun, or held, is not on its own. */
  selfDestructs: number;
  /** Self-destructs within 180 frames of the end of the fighter's own Final Smash. */
  finalSmashSelfDestructs: number;
  /** Self-destructs of a Kirby who had someone in his mouth off the stage in the 180 frames before. */
  kirbyInhaleSelfDestructs: number;
  /** Times a CPU left the floor on a frame its `edgeguard` behaviour won: the edgeguard's chase off the stage. */
  edgeguardExits: number;
}

export function sweep(o: SweepOptions): SweepStats {
  const ctx = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGE_BY_ID.get(id)! }, readBakeFromDisk());
  const stats: SweepStats = {
    matches: 0,
    finalSmashes: {},
    longestStandby: 0,
    holds: {},
    kongKarry: 0,
    dashAttacks: {},
    selfDestructs: 0,
    finalSmashSelfDestructs: 0,
    kirbyInhaleSelfDestructs: 0,
    edgeguardExits: 0,
  };
  const rules: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: o.ball, oneOnOne: true };
  for (const stageId of o.stages) {
    for (const pair of o.pairs) {
      for (const seed of o.seeds) {
        let s: GameState = createInitialState(stageId, pair.map((defId) => ({ defId })), rules, seed, ctx);
        const view = stageViewFromDef(ctx.stage(stageId));
        const defs = s.fighters.map((f) => ctx.fighter(f.defId));
        const worlds: CpuWorld[] = defs.map((def) => cpuWorldFromDef(def, view, defs, (id) => ctx.fighter(id), ctx.bake));
        let cpuSeed = seed ^ 0x1f2e3d4c;
        let prev: readonly InputFrame[] = s.fighters.map(() => 0);
        const ports = s.fighters.map(() => 0);
        const lastHitTaken = ports.map(() => -1_000);
        const lastStood = ports.map(() => 0);
        const lastFinal = ports.map(() => -1_000);
        const lastOffstageMouthful = ports.map(() => -1_000);
        const standby = ports.map(() => 0);
        const inFinal = ports.map(() => false);
        const landedThisFinal = ports.map(() => false);
        const dashOpen = ports.map(() => false);
        const dashHit = ports.map(() => false);
        const dashMisses = ports.map(() => 0);
        for (let frame = 1; frame <= o.frames && s.outcome === null; frame++) {
          const behaviours: string[] = [];
          const inputs = s.fighters.map((_, port) => {
            const d = decideCpu(s, port, o.level, cpuSeed, worlds[port]);
            cpuSeed = d.seed;
            behaviours.push(d.behaviour);
            return d.input;
          });
          const before = s;
          const out = step(s, inputs, { prevInputs: prev, ctx });
          s = out.state;
          prev = inputs;
          for (const h of out.events.hits) {
            lastHitTaken[h.victim] = frame;
            if (inFinal[h.attacker]) landedThisFinal[h.attacker] = true;
            if (before.fighters[h.attacker].move === "dashAttack" || s.fighters[h.attacker].move === "dashAttack") dashHit[h.attacker] = true;
          }
          for (const f of s.fighters) {
            const was = before.fighters[f.port];
            const id = f.defId;
            // Standing on its own: not frozen in a hit's hitlag or reeling in its hitstun, where a
            // fighter hit on the ground still stands, nor held (Plan 6, Task 23: such a KO is somebody's).
            if (f.grounded && !isStunned(f) && f.grabbedBy < 0) lastStood[f.port] = frame;
            if (f.finalSmashReady > 0) standby[f.port] += 1;
            else if (standby[f.port] > 0) {
              const h = (stats.holds[id] ??= { holds: 0, frames: 0 });
              h.holds += 1;
              h.frames += standby[f.port];
              standby[f.port] = 0;
            }
            stats.longestStandby = Math.max(stats.longestStandby, standby[f.port]);
            if (f.action === "finalTrapped" && f.combat.trappedBy >= 0) landedThisFinal[f.combat.trappedBy] = true;
            const final = f.action === "special" && isFinalSlot(f.move);
            if (final && !inFinal[f.port]) {
              (stats.finalSmashes[id] ??= { fired: 0, landed: 0 }).fired += 1;
              landedThisFinal[f.port] = false;
            }
            if (!final && inFinal[f.port] && landedThisFinal[f.port]) stats.finalSmashes[id].landed += 1;
            if (final) lastFinal[f.port] = frame;
            inFinal[f.port] = final;
            if (f.action === "cargoCarry" && was.action !== "cargoCarry") stats.kongKarry += 1;
            const dashing = f.action === "attack" && f.move === "dashAttack";
            if (dashing && !(was.action === "attack" && was.move === "dashAttack")) {
              const d = (stats.dashAttacks[id] ??= { thrown: 0, whiffRuns: 0 });
              if (dashOpen[f.port]) dashMisses[f.port] = dashHit[f.port] ? 0 : dashMisses[f.port] + 1;
              if (dashMisses[f.port] === DASH_WHIFF_RUN) d.whiffRuns += 1;
              d.thrown += 1;
              dashOpen[f.port] = true;
              dashHit[f.port] = false;
            }
            if (behaviours[f.port] === "edgeguard" && was.grounded && !f.grounded) stats.edgeguardExits += 1;
            const offstage = f.x < view.leftLedge || f.x > view.rightLedge;
            if (id === "kirby" && f.action === "inhaleHold" && !f.grounded && offstage) lastOffstageMouthful[f.port] = frame;
          }
          for (const ko of out.events.kos) {
            // Hit after (or on) the last frame it stood: a KO by somebody, however long its fall.
            if (lastStood[ko.port] <= lastHitTaken[ko.port]) continue;
            stats.selfDestructs += 1;
            if (frame - lastFinal[ko.port] <= 180) stats.finalSmashSelfDestructs += 1;
            if (frame - lastOffstageMouthful[ko.port] <= 180) stats.kirbyInhaleSelfDestructs += 1;
          }
        }
        for (const f of s.fighters) {
          if (standby[f.port] === 0) continue;
          const h = (stats.holds[f.defId] ??= { holds: 0, frames: 0 });
          h.holds += 1;
          h.frames += standby[f.port];
        }
        stats.matches += 1;
      }
    }
  }
  return stats;
}
