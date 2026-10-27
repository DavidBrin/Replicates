import { describe, expect, it } from "vitest";

import { parseLobbyMessage, type OnlineMatchConfig } from "./lobby";

const CONFIG: OnlineMatchConfig = {
  seed: 1234,
  stageId: "battlefield",
  stageForm: "omega",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};

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
      { kind: "start", config: { ...CONFIG, fighters: ["mario"] } },
      { kind: "start", config: { ...CONFIG, rules: { ...CONFIG.rules, stocks: 0 } } },
      { kind: "start", config: { ...CONFIG, rules: { ...CONFIG.rules, mode: "coin" } } },
      { kind: "start", config: { ...CONFIG, seed: 1.5 } },
      { kind: "away", away: "yes" },
      { kind: "explode" },
    ];
    for (const payload of bad) expect(parseLobbyMessage(payload)).toBeNull();
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
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, fighters: ["mario", "nobody"] } })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, fighters: ["random", "fox"] } })).toBeNull();
  });

  it("refuses a stage this build does not have, and a stage form passed off as a stage", () => {
    expect(parseLobbyMessage({ kind: "stage", stageId: "no-such-stage", form: "normal" })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, stageId: "no-such-stage" } })).toBeNull();
    // A form id is registered with the engine but is not a base stage: the form travels separately.
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, stageId: "battlefield-omega" } })).toBeNull();
  });

  it("refuses a start that still says Random, which only the host may resolve", () => {
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, stageId: "random" } })).toBeNull();
  });

  it("refuses numbers that are not finite or are outside what the menus can produce", () => {
    const seeds = [Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, -(2 ** 31) - 1, 1e300];
    for (const seed of seeds) expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, seed } })).toBeNull();
    const timeLimits = [Number.NaN, Number.POSITIVE_INFINITY, -1, 1e300, 99 * 60 * 60 + 1];
    for (const timeLimit of timeLimits) {
      expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, rules: { ...CONFIG.rules, timeLimit } } })).toBeNull();
    }
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, rules: { ...CONFIG.rules, stocks: 100 } } })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, costumes: [0, -1] } })).toBeNull();
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
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, seed: "1234" } })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, fighters: "mariofox" } })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, costumes: ["0", "1"] } })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, rules: { ...CONFIG.rules, smashBall: 1 } } })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, rules: [] } })).toBeNull();
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
        "fighters": ["mario", "fox"], "costumes": [0, 1],
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
    expect(Object.keys(parsed.config).sort()).toEqual(["costumes", "fighters", "rules", "seed", "stageForm", "stageId"]);
    expect(Object.keys(parsed.config.rules).sort()).toEqual(["mode", "oneOnOne", "smashBall", "stocks", "timeLimit"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.config)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.config.rules)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("copies nothing extra out of a pick, a stage or an away either", () => {
    const pick = parseLobbyMessage(JSON.parse('{"kind":"pick","fighterId":"fox","costume":1,"__proto__":{"x":1},"extra":true}'));
    expect(Object.keys(pick ?? {}).sort()).toEqual(["costume", "fighterId", "kind"]);
    const stage = parseLobbyMessage(JSON.parse('{"kind":"stage","stageId":"battlefield","form":"normal","__proto__":{"x":1}}'));
    expect(Object.keys(stage ?? {}).sort()).toEqual(["form", "kind", "stageId"]);
    const away = parseLobbyMessage(JSON.parse('{"kind":"away","away":false,"__proto__":{"x":1}}'));
    expect(Object.keys(away ?? {}).sort()).toEqual(["away", "kind"]);
  });

  it("reads the config's arrays as exactly two entries, not by prototype or length tricks", () => {
    const sparse: unknown[] = [];
    sparse[1] = "fox";
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, fighters: sparse } })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, fighters: ["mario", "fox", "mario"] } })).toBeNull();
    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, costumes: [0] } })).toBeNull();
  });
});
