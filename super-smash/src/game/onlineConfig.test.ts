import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { ENGINE_RULES_VERSION } from "@/engine/constants";
import type { MatchRules } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";
import { RANDOM_FIGHTER, RANDOM_STAGE, type PlayerSlot } from "@/lib/matchConfig";
import { parseLobbyMessage } from "@/net/online/lobby";
import { PROTOCOL_VERSION } from "@/net/packet";
import { FIGHTERS, STAGES, bootstrapEngine, resolveMatchStage } from "./bootstrap";
import { buildMismatch, buildStartConfig, describeMismatch, localBuild, newMatchSeed, runnerSlotsFor } from "./onlineConfig";
import type { SimContext } from "@/engine/simulate";
import { GAME_ENGINE_RULES, GAME_SIM_CONTEXT, engineFingerprint, rulesFingerprint, type EngineRules } from "./simContext";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: true, oneOnOne: false };

function players(a: string | null, b: string | null): PlayerSlot[] {
  return [
    { port: 0, kind: "human", cpuLevel: 3, fighterId: a, costume: 0, scheme: "arrows" },
    { port: 1, kind: "human", cpuLevel: 3, fighterId: b, costume: 1, scheme: "arrows" },
  ];
}

beforeAll(() => {
  bootstrapEngine();
});

describe("the host's start config", () => {
  it("resolves Random before it leaves the host, so both peers load the same match", () => {
    const config = buildStartConfig({ players: players(RANDOM_FIGHTER, "fox"), stageId: RANDOM_STAGE, stageForm: "omega", rules: RULES, seed: 1234 });
    expect(FIGHTERS.map((f) => f.id)).toContain(config.fighters[0]);
    expect(config.fighters[1]).toBe("fox");
    expect(STAGES.map((s) => s.id)).toContain(config.stageId);
    expect(config.stageForm).toBe("omega");
    expect(config.costumes).toEqual([0, 1]);
  });

  it("gives both peers the same stage, whatever seed each would have used", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: RANDOM_STAGE, stageForm: "battlefield", rules: RULES, seed: 99 });
    expect(resolveMatchStage(config.stageId, config.stageForm, config.seed).id).toBe(
      resolveMatchStage(config.stageId, config.stageForm, 7).id,
    );
  });

  it("treats a fighter id it does not know as Random rather than crashing both games", () => {
    const config = buildStartConfig({ players: players("not-a-fighter", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect(FIGHTERS.map((f) => f.id)).toContain(config.fighters[0]);
  });

  it("always plays the 1v1 rules online", () => {
    expect(buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 }).rules.oneOnOne).toBe(true);
  });

  it("refuses anything but two players", () => {
    expect(() =>
      buildStartConfig({ players: players("mario", "fox").slice(0, 1), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 }),
    ).toThrow(/two players/);
  });

  it("survives its own wire format", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect(parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "start", config })))).toEqual({ kind: "start", config });
  });

  it("survives its own wire format even when everything was Random and the seed is negative", () => {
    const config = buildStartConfig({
      players: players(RANDOM_FIGHTER, null),
      stageId: RANDOM_STAGE,
      stageForm: "battlefield",
      rules: RULES,
      seed: 0xdead_beef,
    });
    expect(config.seed).toBeLessThan(0);
    expect(parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "start", config })))).toEqual({ kind: "start", config });
  });

  it("carries this build's stamp, so the guest can check it before playing", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect({ build: config.build, protocol: config.protocol, bones: config.bones, engineRules: config.engineRules }).toEqual(localBuild());
    expect(config.bones).toBe(engineFingerprint());
    expect(config.engineRules).toBe(rulesFingerprint());
    expect(buildMismatch(config)).toBeNull();
    expect(buildMismatch({ ...config, bones: "0badf00d" })).toBe("bones");
    expect(buildMismatch({ ...config, engineRules: "0badf00d" })).toBe("rules");
  });

  it("makes a positive 31-bit seed", () => {
    expect(newMatchSeed(() => 0.5)).toBe(Math.floor(0.5 * 0x7fff_ffff));
    expect(newMatchSeed(() => 0)).toBe(0);
  });

  it("turns a config into the runner's two human slots", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect(runnerSlotsFor(config)).toEqual([
      { selection: { defId: "mario", costume: 0 }, cpuLevel: null, label: "P1" },
      { selection: { defId: "fox", costume: 1 }, cpuLevel: null, label: "P2" },
    ]);
  });
});

describe("this build, as the other player sees it", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is the deploy, the wire format, the engine and its rules", () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "82267f71aab9");
    expect(localBuild()).toEqual({ build: "82267f71aab9", protocol: PROTOCOL_VERSION, bones: engineFingerprint(), engineRules: rulesFingerprint() });
  });

  /**
   * The stamp is made when it is asked for, not when this module loaded: Plan 4
   * installs its bake and its limb-bone scripts into `GAME_SIM_CONTEXT` and
   * `GAME_ENGINE_RULES` after load, and the next hello must say so.
   */
  it("is made when asked for, so rules or bones installed after load show in the next stamp", () => {
    const before = localBuild();
    const rules = GAME_ENGINE_RULES as { activeSlots: EngineRules["activeSlots"] };
    const context = GAME_SIM_CONTEXT as { bones?: SimContext["bones"] };
    const { activeSlots } = GAME_ENGINE_RULES;
    const { bones } = GAME_SIM_CONTEXT;
    try {
      rules.activeSlots = { ...activeSlots, mario: activeSlots.mario.slice(1) };
      const fewer = localBuild();
      expect(fewer.engineRules).not.toBe(before.engineRules);
      expect(fewer.bones).not.toBe(before.bones);
      rules.activeSlots = activeSlots;
      context.bones = { ...LEGACY_BONE_TABLE, fingerprint: "0badf00d" };
      const other = localBuild();
      expect(other.engineRules).toBe(before.engineRules);
      expect(other.bones).not.toBe(before.bones);
    } finally {
      rules.activeSlots = activeSlots;
      context.bones = bones;
    }
    expect(localBuild()).toEqual(before);
  });

  /**
   * A Plan 2 peer compares only `bones` (its bone table's fingerprint), `protocol`
   * and `build`. This build's `bones` holds the rules too, so it is never a bare
   * bone table's: that peer refuses this one on the same build id, and leaves.
   */
  it("says engine fingerprint bones that a Plan 2 peer, which knows only a bone table's, refuses", () => {
    expect(localBuild().bones).not.toBe(LEGACY_BONE_TABLE.fingerprint);
  });

  /** Vitest, and anything else Next did not build: every one of them is the same "dev" build. */
  it("is the dev build when Next did not stamp one", () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", undefined);
    expect(localBuild().build).toBe("dev");
  });

  it("plays a peer on the same build", () => {
    expect(buildMismatch(localBuild())).toBeNull();
    const theirs = { build: "0123456789ab", protocol: 7, bones: "0badf00d", engineRules: "4567ef01" };
    expect(buildMismatch(theirs, { ...theirs })).toBeNull();
  });

  it("refuses a peer on another wire format, whose packets it could not read", () => {
    expect(buildMismatch({ ...localBuild(), protocol: PROTOCOL_VERSION + 1 })).toBe("protocol");
  });

  /** What a build with another bone table says: its engine fingerprint moves, its rules' part does not. */
  it("refuses a peer with other bone tables, whose hitboxes would land elsewhere", () => {
    const other = { ...GAME_SIM_CONTEXT, bones: { ...LEGACY_BONE_TABLE, fingerprint: "0badf00d" } };
    const theirs = { ...localBuild(), bones: engineFingerprint(other) };
    expect(theirs.bones).not.toBe(localBuild().bones);
    expect(buildMismatch(theirs)).toBe("bones");
  });

  /** What a build with other combat rules says: the version, or which scripts run, moves both fingerprints. */
  const OTHER_RULES: readonly [string, EngineRules][] = [
    ["rules version", { version: ENGINE_RULES_VERSION + 1, activeSlots: ACTIVE_SCRIPT_SLOTS }],
    ["running scripts", { version: ENGINE_RULES_VERSION, activeSlots: { ...ACTIVE_SCRIPT_SLOTS, mario: ACTIVE_SCRIPT_SLOTS.mario.slice(1) } }],
  ];

  it.each(OTHER_RULES)("refuses a peer on the same build with another %s, which would desync on the first hit", (_, rules) => {
    const theirs = { ...localBuild(), bones: engineFingerprint(GAME_SIM_CONTEXT, rules), engineRules: rulesFingerprint(rules) };
    expect(theirs.build).toBe(localBuild().build);
    expect(theirs.bones).not.toBe(localBuild().bones);
    expect(buildMismatch(theirs)).toBe("rules");
  });

  it("names the rules before the bones and the deploy, the most telling first", () => {
    expect(buildMismatch({ ...localBuild(), engineRules: "0badf00d" })).toBe("rules");
    expect(buildMismatch({ ...localBuild(), engineRules: "0badf00d", bones: "0badf00d", build: "fedcba987654" })).toBe("rules");
    expect(buildMismatch({ ...localBuild(), bones: "0badf00d", build: "fedcba987654" })).toBe("bones");
  });

  /** Any change to the simulation is a different game, and only the deploy's id sees most of them. */
  it("refuses a peer on another deploy, even with the same wire format and bone tables", () => {
    expect(buildMismatch({ ...localBuild(), build: "fedcba987654" })).toBe("build");
    const theirs = { build: "0123456789ab", protocol: 7, bones: "0badf00d", engineRules: "4567ef01" };
    expect(buildMismatch(theirs, { ...theirs, build: "fedcba987654" })).toBe("build");
  });

  it("refuses a peer that never said, which is a build from before the handshake", () => {
    expect(buildMismatch(null)).toBe("missing");
  });

  /** For a developer's console: the sentence players read is the same for every one of these. */
  it("says which part differs, for a developer, and what each side has", () => {
    const ours = { build: "fedcba987654", protocol: 7, bones: "0badf00d", engineRules: "4567ef01" };
    expect(describeMismatch("missing", null, ours)).toMatch(/no build stamp this build can read/);
    expect(describeMismatch("protocol", { ...ours, protocol: 8 }, ours)).toBe("its wire format is 8, this build's is 7");
    expect(describeMismatch("rules", { ...ours, engineRules: "89abcdef" }, ours)).toBe("its engine rules are 89abcdef, this build's are 4567ef01");
    expect(describeMismatch("bones", { ...ours, bones: "89abcdef" }, ours)).toBe("its engine is 89abcdef, this build's is 0badf00d (the bone table, as the rules agree)");
    expect(describeMismatch("build", { ...ours, build: "0123456789ab" }, ours)).toBe("it is build 0123456789ab, this one is fedcba987654");
  });
});
