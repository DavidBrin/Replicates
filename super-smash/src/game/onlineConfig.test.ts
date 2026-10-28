import { beforeAll, describe, expect, it } from "vitest";

import type { MatchRules } from "@/engine/types";
import { RANDOM_FIGHTER, RANDOM_STAGE, type PlayerSlot } from "@/lib/matchConfig";
import { parseLobbyMessage } from "@/net/online/lobby";
import { PROTOCOL_VERSION } from "@/net/packet";
import { FIGHTERS, STAGES, bootstrapEngine, resolveMatchStage } from "./bootstrap";
import { buildMismatch, buildStartConfig, localBuild, newMatchSeed, runnerSlotsFor } from "./onlineConfig";
import { engineFingerprint } from "./simContext";

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
  it("is the wire format and the bone table", () => {
    expect(localBuild()).toEqual({ protocol: PROTOCOL_VERSION, bones: engineFingerprint() });
  });

  it("plays a peer on the same build", () => {
    expect(buildMismatch(localBuild())).toBeNull();
    expect(buildMismatch({ protocol: 7, bones: "0badf00d" }, { protocol: 7, bones: "0badf00d" })).toBeNull();
  });

  it("refuses a peer on another wire format, whose packets it could not read", () => {
    expect(buildMismatch({ ...localBuild(), protocol: PROTOCOL_VERSION + 1 })).toBe("protocol");
  });

  it("refuses a peer with other bone tables, whose hitboxes would land elsewhere", () => {
    expect(buildMismatch({ ...localBuild(), bones: "0badf00d" })).toBe("bones");
  });

  it("refuses a peer that never said, which is a build from before the handshake", () => {
    expect(buildMismatch(null)).toBe("missing");
  });
});
