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
import { engineFingerprint, rulesFingerprint } from "./simContext";

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
    ...localBuild(),
  };
}

/**
 * This build, as the other player sees it (Plan 2 Task 27). The deploy's id is
 * the one thing the browser code reads from the environment: next.config.ts
 * stamps it, and Next inlines it at build time. Vitest, and anything else Next
 * did not build, is "dev".
 */
export function localBuild(): BuildStamp {
  return {
    build: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
    protocol: PROTOCOL_VERSION,
    bones: engineFingerprint(),
    engineRules: rulesFingerprint(),
  };
}

/**
 * Why a peer's build cannot play this one: it never said (a build from before
 * the handshake, or before the rules' part of the stamp), its packets are
 * another wire format, its combat rules differ (the rules version, or which
 * imported scripts run: Plan 3 Task 20), its bone tables put hitboxes
 * elsewhere, or it is another deploy — whose simulation, changed in ways none
 * of the others shows, would desync. The most telling first; the screens say
 * the same sentence for each, and `describeMismatch` says which, for a
 * developer.
 */
export type BuildMismatch = "missing" | "protocol" | "rules" | "bones" | "build";

/**
 * Null when the two builds can play each other. `bones` is the whole engine
 * fingerprint, the rules included, so it is read after `engineRules`: by then
 * a difference in it can only be the bone table's.
 */
export function buildMismatch(theirs: BuildStamp | null, ours: BuildStamp = localBuild()): BuildMismatch | null {
  if (theirs === null) return "missing";
  if (theirs.protocol !== ours.protocol) return "protocol";
  if (theirs.engineRules !== ours.engineRules) return "rules";
  if (theirs.bones !== ours.bones) return "bones";
  if (theirs.build !== ours.build) return "build";
  return null;
}

const NO_STAMP = "it sent no build stamp this build can read (a build from before the handshake, or before its rules' part)";

/**
 * What a developer reads in the console when a peer is refused (the players
 * read one sentence whatever the cause): which part differs, and what each
 * side has.
 */
export function describeMismatch(why: BuildMismatch, theirs: BuildStamp | null, ours: BuildStamp = localBuild()): string {
  if (theirs === null || why === "missing") return NO_STAMP;
  switch (why) {
    case "protocol":
      return `its wire format is ${theirs.protocol}, this build's is ${ours.protocol}`;
    case "rules":
      return `its engine rules are ${theirs.engineRules}, this build's are ${ours.engineRules}`;
    case "bones":
      return `its engine is ${theirs.bones}, this build's is ${ours.bones} (the bone table, as the rules agree)`;
    case "build":
      return `it is build ${theirs.build}, this one is ${ours.build}`;
  }
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
