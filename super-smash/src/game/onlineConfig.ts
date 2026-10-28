/**
 * The host's half of starting an online match.
 *
 * Everything that could differ between two machines is decided here, once,
 * and shipped: the seed, which roster entry Random became, which stage. The
 * guest never resolves anything itself — `resolveMatchStage` on a concrete id
 * ignores the seed, so both peers land on the same `StageDef`.
 */

import type { MatchRules } from "@/engine/types";
import { RANDOM_FIGHTER, type PlayerSlot, type StageForm } from "@/lib/matchConfig";
import type { BuildStamp, OnlineMatchConfig } from "@/net/online/lobby";
import { PROTOCOL_VERSION } from "@/net/packet";
import { FIGHTERS, resolveFighterId, resolveMatchStage } from "./bootstrap";
import type { PlayerSlot as RunnerSlot } from "./matchRunner";
import { engineFingerprint } from "./simContext";

export interface StartConfigInput {
  readonly players: readonly PlayerSlot[];
  readonly stageId: string;
  readonly stageForm: StageForm;
  readonly rules: MatchRules;
  readonly seed: number;
}

export function buildStartConfig(input: StartConfigInput): OnlineMatchConfig {
  if (input.players.length !== 2) throw new Error(`An online match is two players, not ${input.players.length}`);
  const [p0, p1] = input.players;
  const seed = input.seed | 0;
  return {
    seed,
    // "normal" leaves the base id untouched; the form travels separately.
    stageId: resolveMatchStage(input.stageId, "normal", seed).id,
    stageForm: input.stageForm,
    rules: { ...input.rules, oneOnOne: true },
    fighters: [resolveFighterId(known(p0.fighterId), seed, 0), resolveFighterId(known(p1.fighterId), seed, 1)],
    costumes: [p0.costume, p1.costume],
  };
}

/** This build, as the other player's sees it (Plan 2 Task 27). */
export function localBuild(): BuildStamp {
  return { protocol: PROTOCOL_VERSION, bones: engineFingerprint() };
}

/**
 * Why a peer's build cannot play this one: it never said (a build from before
 * the handshake), its packets are another wire format, or its bone tables put
 * hitboxes elsewhere — rollback would desync on the first hit.
 */
export type BuildMismatch = "missing" | "protocol" | "bones";

/** Null when the two builds can play each other. */
export function buildMismatch(theirs: BuildStamp | null, ours: BuildStamp = localBuild()): BuildMismatch | null {
  if (theirs === null) return "missing";
  if (theirs.protocol !== ours.protocol) return "protocol";
  if (theirs.bones !== ours.bones) return "bones";
  return null;
}

/** Outside the simulation, so `Math.random` is allowed; the result enters it only as data. */
export function newMatchSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0x7fff_ffff) | 0;
}

export function runnerSlotsFor(config: OnlineMatchConfig): RunnerSlot[] {
  return config.fighters.map((defId, port) => ({
    selection: { defId, costume: config.costumes[port] },
    cpuLevel: null,
    label: `P${port + 1}`,
  }));
}

/** A pick from the wire that names no fighter in this build plays as Random. */
function known(id: string | null): string {
  return id !== null && FIGHTERS.some((f) => f.id === id) ? id : RANDOM_FIGHTER;
}
