import { describe, expect, it } from "vitest";

import { parseLobbyMessage, type BuildStamp, type OnlineMatchConfig } from "./lobby";

const CONFIG: OnlineMatchConfig = {
  seed: 1234,
  stageId: "battlefield",
  stageForm: "omega",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
  build: "0123456789ab",
  protocol: 2,
  bones: "0123abcd",
  engineRules: "4567ef01",
};

const BUILD: BuildStamp = { build: CONFIG.build, protocol: CONFIG.protocol, bones: CONFIG.bones, engineRules: CONFIG.engineRules };

/** A hello with its stamp as `BUILD` says it, but for the fields `over` sets (to `undefined` to leave one out). */
function helloWith(over: Record<string, unknown>): Record<string, unknown> {
  return { kind: "hello", build: BUILD.build, protocol: BUILD.protocol, bones: BUILD.bones, engineRules: BUILD.engineRules, ...over };
}

/**
 * A start this build cannot play is never read as one. Only the build it
 * claims comes through, read before anything else, so the guest can refuse
 * another build's start rather than drop it in silence (Plan 2 Task 27).
 */
function expectUnplayable(config: unknown, build: BuildStamp | null = BUILD) {
  expect(parseLobbyMessage({ kind: "start", config })).toEqual({ kind: "unreadable-start", build });
}

describe("lobby messages", () => {
  it("reads a pick, including clearing one", () => {
    expect(parseLobbyMessage({ kind: "pick", fighterId: "fox", costume: 2 })).toEqual({ kind: "pick", fighterId: "fox", costume: 2 });
    expect(parseLobbyMessage({ kind: "pick", fighterId: null, costume: 0 })).toEqual({ kind: "pick", fighterId: null, costume: 0 });
  });

  it("reads the Random pick, which is a token rather than a roster entry", () => {
    expect(parseLobbyMessage({ kind: "pick", fighterId: "random", costume: 0 })).toEqual({ kind: "pick", fighterId: "random", costume: 0 });
  });

  it("reads the host's stage", () => {
    expect(parseLobbyMessage({ kind: "stage", stageId: "smashville", form: "battlefield" })).toEqual({
      kind: "stage",
      stageId: "smashville",
      form: "battlefield",
    });
  });

  it("reads the host's rules along with its stage, for the guest to see", () => {
    expect(parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "stage", stageId: "smashville", form: "normal", rules: CONFIG.rules })))).toEqual({
      kind: "stage",
      stageId: "smashville",
      form: "normal",
      rules: CONFIG.rules,
    });
  });

  /** Only shown, never played (the start carries the rules the match runs on), so they cannot cost the stage. */
  it("reads a stage without rules, or with rules it cannot read, as a stage without them", () => {
    const plain = { kind: "stage", stageId: "smashville", form: "normal" };
    for (const rules of [undefined, null, "3 stocks", { ...CONFIG.rules, stocks: 0 }, { ...CONFIG.rules, mode: "coins" }, []]) {
      const parsed = parseLobbyMessage({ ...plain, rules });
      expect(parsed).toEqual(plain);
      expect(Object.keys(parsed ?? {}).sort()).toEqual(["form", "kind", "stageId"]);
    }
  });

  it("reads Random as the host's stage, which the host resolves at start", () => {
    expect(parseLobbyMessage({ kind: "stage", stageId: "random", form: "normal" })).toEqual({
      kind: "stage",
      stageId: "random",
      form: "normal",
    });
  });

  it("reads a start with its whole config, as it arrives off the wire", () => {
    expect(parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "start", config: CONFIG })))).toEqual({ kind: "start", config: CONFIG });
  });

  it("reads a hello: the build the other side runs", () => {
    const hello = { kind: "hello", build: "0123456789ab", protocol: 2, bones: "0123abcd", engineRules: "4567ef01" };
    expect(parseLobbyMessage(hello)).toEqual(hello);
    // A build git could not name, the longest commit id git prints, and one
    // built with uncommitted changes (next.config.ts marks it).
    expect(parseLobbyMessage({ ...hello, build: "dev" })).toEqual({ ...hello, build: "dev" });
    expect(parseLobbyMessage({ ...hello, build: "0".repeat(40) })).toEqual({ ...hello, build: "0".repeat(40) });
    expect(parseLobbyMessage({ ...hello, build: "0123456789ab-89abcdef" })).toEqual({ ...hello, build: "0123456789ab-89abcdef" });
  });

  it("reads a refusal, so a host learns why its start was not played", () => {
    expect(parseLobbyMessage({ kind: "refuse", reason: "engine-mismatch" })).toEqual({ kind: "refuse", reason: "engine-mismatch" });
    expect(parseLobbyMessage({ kind: "refuse", reason: "unreadable-start" })).toEqual({ kind: "refuse", reason: "unreadable-start" });
  });

  it("reads an away flag", () => {
    expect(parseLobbyMessage({ kind: "away", away: true })).toEqual({ kind: "away", away: true });
  });

  it("refuses anything a peer could use to break the other side", () => {
    const bad: unknown[] = [
      null,
      "pick",
      { kind: "pick", fighterId: "../etc", costume: 0 },
      { kind: "pick", fighterId: "fox", costume: 99 },
      { kind: "pick", fighterId: "fox", costume: 1.5 },
      { kind: "stage", stageId: "battlefield", form: "mirror" },
      { kind: "away", away: "yes" },
      { kind: "refuse", reason: "bored" },
      { kind: "refuse" },
      helloWith({ bones: "not-hex!" }),
      helloWith({ bones: "0123ABCD" }),
      helloWith({ protocol: 1.5 }),
      helloWith({ protocol: 256 }),
      helloWith({ protocol: undefined }),
      helloWith({ bones: undefined }),
      helloWith({ build: undefined }),
      helloWith({ build: "012345" }),
      helloWith({ build: "0".repeat(41) }),
      helloWith({ build: "0123456789AB" }),
      helloWith({ build: "v1.2.3" }),
      helloWith({ build: "0123456789ab-dirty" }),
      helloWith({ build: "0123456789ab-89abcde" }),
      helloWith({ build: "dev-89abcdef" }),
      helloWith({ build: 123456789 }),
      // The rules' part of the stamp (Plan 3 Task 20): a hello from a build
      // before it, or one that mangles it, is not a hello.
      helloWith({ engineRules: undefined }),
      helloWith({ engineRules: "not-hex!" }),
      helloWith({ engineRules: "4567EF01" }),
      helloWith({ engineRules: "4567ef0" }),
      helloWith({ engineRules: 0x4567ef01 }),
      { kind: "explode" },
    ];
    for (const payload of bad) expect(parseLobbyMessage(payload)).toBeNull();
    expectUnplayable({ ...CONFIG, fighters: ["mario"] });
    expectUnplayable({ ...CONFIG, rules: { ...CONFIG.rules, stocks: 0 } });
    expectUnplayable({ ...CONFIG, rules: { ...CONFIG.rules, mode: "coin" } });
    expectUnplayable({ ...CONFIG, seed: 1.5 });
  });
});

/**
 * The shapes below are well-formed JSON that a hostile or out-of-date peer can
 * still send. Each would pass a "looks like an id" check and then fail, or do
 * something worse, once the match is built from it.
 */
describe("lobby messages from a hostile or mismatched peer", () => {
  it("refuses a fighter this build does not have, so the match is never built from it", () => {
    expect(parseLobbyMessage({ kind: "pick", fighterId: "mewtwo-from-the-future", costume: 0 })).toBeNull();
    expectUnplayable({ ...CONFIG, fighters: ["mario", "nobody"] });
    expectUnplayable({ ...CONFIG, fighters: ["random", "fox"] });
  });

  it("refuses a stage this build does not have, and a stage form passed off as a stage", () => {
    expect(parseLobbyMessage({ kind: "stage", stageId: "no-such-stage", form: "normal" })).toBeNull();
    expectUnplayable({ ...CONFIG, stageId: "no-such-stage" });
    // A form id is registered with the engine but is not a base stage: the form travels separately.
    expectUnplayable({ ...CONFIG, stageId: "battlefield-omega" });
  });

  it("refuses a start that still says Random, which only the host may resolve", () => {
    expectUnplayable({ ...CONFIG, stageId: "random" });
  });

  it("refuses numbers that are not finite or are outside what the menus can produce", () => {
    const seeds = [Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, -(2 ** 31) - 1, 1e300];
    for (const seed of seeds) expectUnplayable({ ...CONFIG, seed });
    const timeLimits = [Number.NaN, Number.POSITIVE_INFINITY, -1, 1e300, 99 * 60 * 60 + 1];
    for (const timeLimit of timeLimits) {
      expectUnplayable({ ...CONFIG, rules: { ...CONFIG.rules, timeLimit } });
    }
    expectUnplayable({ ...CONFIG, rules: { ...CONFIG.rules, stocks: 100 } });
    expectUnplayable({ ...CONFIG, costumes: [0, -1] });
    expect(parseLobbyMessage({ kind: "pick", fighterId: "fox", costume: Number.NaN })).toBeNull();
    expect(parseLobbyMessage({ kind: "pick", fighterId: "fox", costume: -1 })).toBeNull();
  });

  it("accepts the extremes of the ranges it documents", () => {
    const edge = { ...CONFIG, seed: -(2 ** 31), rules: { ...CONFIG.rules, stocks: 99, timeLimit: 99 * 60 * 60 } };
    expect(parseLobbyMessage({ kind: "start", config: edge })).toEqual({ kind: "start", config: edge });
    expect(parseLobbyMessage({ kind: "start", config: { ...edge, seed: 2 ** 31 - 1 } })).toEqual({
      kind: "start",
      config: { ...edge, seed: 2 ** 31 - 1 },
    });
  });

  it("refuses fields of the wrong type rather than coercing them", () => {
    expectUnplayable({ ...CONFIG, seed: "1234" });
    expectUnplayable({ ...CONFIG, fighters: "mariofox" });
    expectUnplayable({ ...CONFIG, costumes: ["0", "1"] });
    expectUnplayable({ ...CONFIG, rules: { ...CONFIG.rules, smashBall: 1 } });
    expectUnplayable({ ...CONFIG, rules: [] });
    expect(parseLobbyMessage({ kind: "start", config: [] })).toBeNull();
    expect(parseLobbyMessage({ kind: "start" })).toBeNull();
  });

  it("builds its result from the fields it read, never from the payload itself", () => {
    // JSON.parse makes `__proto__` an ordinary own property, and the other
    // extras are just noise: none of them may appear on what comes back.
    const wire = `{
      "kind": "start",
      "__proto__": { "polluted": true },
      "extra": 1,
      "config": {
        "seed": 1234, "stageId": "battlefield", "stageForm": "omega",
        "fighters": ["mario", "fox"], "costumes": [0, 1], "build": "0123456789ab", "protocol": 2, "bones": "0123abcd",
        "engineRules": "4567ef01",
        "__proto__": { "polluted": true }, "extra": 2,
        "rules": {
          "mode": "stock", "stocks": 3, "timeLimit": 9000, "smashBall": false, "oneOnOne": true,
          "__proto__": { "polluted": true }, "extra": 3
        }
      }
    }`;
    const parsed = parseLobbyMessage(JSON.parse(wire));
    expect(parsed).toEqual({ kind: "start", config: CONFIG });
    if (parsed?.kind !== "start") throw new Error("expected a start");
    expect(Object.keys(parsed).sort()).toEqual(["config", "kind"]);
    expect(Object.keys(parsed.config).sort()).toEqual([
      "bones",
      "build",
      "costumes",
      "engineRules",
      "fighters",
      "protocol",
      "rules",
      "seed",
      "stageForm",
      "stageId",
    ]);
    expect(Object.keys(parsed.config.rules).sort()).toEqual(["mode", "oneOnOne", "smashBall", "stocks", "timeLimit"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.config)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.config.rules)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("copies nothing extra out of a pick, a stage, an away or a hello either", () => {
    const pick = parseLobbyMessage(JSON.parse('{"kind":"pick","fighterId":"fox","costume":1,"__proto__":{"x":1},"extra":true}'));
    expect(Object.keys(pick ?? {}).sort()).toEqual(["costume", "fighterId", "kind"]);
    const stage = parseLobbyMessage(JSON.parse('{"kind":"stage","stageId":"battlefield","form":"normal","__proto__":{"x":1}}'));
    expect(Object.keys(stage ?? {}).sort()).toEqual(["form", "kind", "stageId"]);
    const away = parseLobbyMessage(JSON.parse('{"kind":"away","away":false,"__proto__":{"x":1}}'));
    expect(Object.keys(away ?? {}).sort()).toEqual(["away", "kind"]);
    const hello = parseLobbyMessage(
      JSON.parse('{"kind":"hello","build":"dev","protocol":2,"bones":"0123abcd","engineRules":"4567ef01","__proto__":{"x":1},"extra":true}'),
    );
    expect(Object.keys(hello ?? {}).sort()).toEqual(["bones", "build", "engineRules", "kind", "protocol"]);
  });

  it("reads a start's build before anything else, so another build's start comes through for the guest to refuse", () => {
    // Readable here, so the guest compares the build itself.
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, bones: "0badf00d" } })).toEqual({
      kind: "start",
      config: { ...CONFIG, bones: "0badf00d" },
    });
    // So is one whose rules differ (Plan 3 Task 20), with the rules' part of the stamp read as sent.
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, engineRules: "0badf00d" } })).toEqual({
      kind: "start",
      config: { ...CONFIG, engineRules: "0badf00d" },
    });
    // A newer build's start can name a fighter this one lacks: its build still comes through.
    expectUnplayable(
      { ...CONFIG, build: "fedcba987654", protocol: 3, fighters: ["mario", "mewtwo-from-the-future"] },
      { build: "fedcba987654", protocol: 3, bones: CONFIG.bones, engineRules: CONFIG.engineRules },
    );
  });

  it("reads a start without a build it can read as a start from an unknown build, never as a start", () => {
    expectUnplayable({ ...CONFIG, bones: undefined }, null);
    // A build from before the rules' part of the stamp (Plan 3 Task 20) says none, or says it wrong.
    expectUnplayable({ ...CONFIG, engineRules: undefined }, null);
    expectUnplayable({ ...CONFIG, engineRules: "not-hex!" }, null);
    expectUnplayable({ ...CONFIG, engineRules: 0x4567ef01 }, null);
    expectUnplayable({ ...CONFIG, protocol: undefined }, null);
    expectUnplayable({ ...CONFIG, bones: "not-hex!" }, null);
    expectUnplayable({ ...CONFIG, protocol: "2" }, null);
    expectUnplayable({ ...CONFIG, build: undefined }, null);
    expectUnplayable({ ...CONFIG, build: "v1.2.3" }, null);
    // A start from before the handshake: everything else this build can read.
    const before: Record<string, unknown> = { ...CONFIG };
    delete before.build;
    delete before.protocol;
    delete before.bones;
    delete before.engineRules;
    expectUnplayable(before, null);
  });

  it("copies nothing extra out of a start it cannot play, or out of a refusal", () => {
    const unplayable = parseLobbyMessage(
      JSON.parse(
        '{"kind":"start","config":{"build":"dev","protocol":3,"bones":"0123abcd","engineRules":"4567ef01","__proto__":{"x":1},"extra":1},"__proto__":{"x":1}}',
      ),
    );
    expect(unplayable).toEqual({ kind: "unreadable-start", build: { build: "dev", protocol: 3, bones: "0123abcd", engineRules: "4567ef01" } });
    if (unplayable?.kind !== "unreadable-start" || unplayable.build === null) throw new Error("expected a build");
    expect(Object.keys(unplayable).sort()).toEqual(["build", "kind"]);
    expect(Object.keys(unplayable.build).sort()).toEqual(["bones", "build", "engineRules", "protocol"]);
    const refuse = parseLobbyMessage(JSON.parse('{"kind":"refuse","reason":"engine-mismatch","__proto__":{"x":1},"extra":true}'));
    expect(Object.keys(refuse ?? {}).sort()).toEqual(["kind", "reason"]);
  });

  it("reads the config's arrays as exactly two entries, not by prototype or length tricks", () => {
    const sparse: unknown[] = [];
    sparse[1] = "fox";
    expectUnplayable({ ...CONFIG, fighters: sparse });
    expectUnplayable({ ...CONFIG, fighters: ["mario", "fox", "mario"] });
    expectUnplayable({ ...CONFIG, costumes: [0] });
  });
});
