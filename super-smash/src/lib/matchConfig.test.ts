import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_BINDINGS,
  MAX_PLAYERS,
  MAX_STOCKS,
  MAX_TIME_FRAMES,
  MIN_PLAYERS,
  MIN_STOCKS,
  MIN_TIME_FRAMES,
  allPortsReady,
  formatTime,
  loadRoster,
  nextStageForm,
  overlappingKeys,
  resetRosterCache,
  stageIdForForm,
  useMatchConfig,
} from "./matchConfig";

const store = () => useMatchConfig.getState();

beforeEach(() => {
  useMatchConfig.getState().reset();
  resetRosterCache();
});

describe("rules", () => {
  it("clamps the stock count to 1–99 rather than refusing the input", () => {
    store().setStocks(0);
    expect(store().rules.stocks).toBe(MIN_STOCKS);

    store().setStocks(500);
    expect(store().rules.stocks).toBe(MAX_STOCKS);
  });

  it("clamps the time limit to 1:00–99:00", () => {
    store().setTimeLimit(0);
    expect(formatTime(store().rules.timeLimit)).toBe("1:00");
    expect(store().rules.timeLimit).toBe(MIN_TIME_FRAMES);

    store().setTimeLimit(MAX_TIME_FRAMES * 2);
    expect(formatTime(store().rules.timeLimit)).toBe("99:00");
  });

  it("defaults to a 3-stock match with a 2:30 clock", () => {
    expect(store().rules.mode).toBe("stock");
    expect(store().rules.stocks).toBe(3);
    expect(formatTime(store().rules.timeLimit)).toBe("2:30");
  });

  /**
   * The 1v1 bonus is not a setting in Ultimate — it is a consequence of the
   * player count — so the store derives it rather than exposing a toggle a
   * player could set to something the real game cannot be in.
   */
  it("derives the 1v1 damage flag from the number of players", () => {
    expect(store().players).toHaveLength(2);
    expect(store().rules.oneOnOne).toBe(true);

    store().addPlayer();
    expect(store().rules.oneOnOne).toBe(false);

    store().removePlayer();
    expect(store().rules.oneOnOne).toBe(true);
  });
});

describe("players", () => {
  it("refuses to go below two players or above four", () => {
    store().removePlayer();
    expect(store().players).toHaveLength(MIN_PLAYERS);

    store().addPlayer();
    store().addPlayer();
    store().addPlayer();
    expect(store().players).toHaveLength(MAX_PLAYERS);
  });

  it("clamps a CPU level to 1–9 from either direction", () => {
    store().setCpuLevel(1, 0);
    expect(store().players[1].cpuLevel).toBe(1);

    store().setCpuLevel(1, 99);
    expect(store().players[1].cpuLevel).toBe(9);

    store().stepCpuLevel(1, 1);
    expect(store().players[1].cpuLevel).toBe(9);

    store().setCpuLevel(1, 5);
    store().stepCpuLevel(1, -1);
    expect(store().players[1].cpuLevel).toBe(4);
  });

  it("only reports ready once every panel holds a fighter", () => {
    expect(allPortsReady(store().players)).toBe(false);

    store().setFighter(0, "mario");
    expect(allPortsReady(store().players)).toBe(false);

    store().setFighter(1, "fox");
    expect(allPortsReady(store().players)).toBe(true);
  });
});

describe("stage form", () => {
  it("cycles Normal → Battlefield → Ω → Normal", () => {
    expect(nextStageForm("normal")).toBe("battlefield");
    expect(nextStageForm("battlefield")).toBe("omega");
    expect(nextStageForm("omega")).toBe("normal");

    store().cycleStageForm();
    expect(store().stageForm).toBe("battlefield");
    store().cycleStageForm();
    store().cycleStageForm();
    expect(store().stageForm).toBe("normal");
  });

  /**
   * The form travels inside the stage id because `GameState.stageId` is a
   * single string that has to survive rollback — see `stageIdForForm`.
   */
  it("folds the form into the id the match will load", () => {
    expect(stageIdForForm("battlefield", "normal")).toBe("battlefield");
    expect(stageIdForForm("smashville", "omega")).toBe("smashville-omega");
    expect(stageIdForForm("smashville", "battlefield")).toBe("smashville-battlefield");
  });
});

describe("control bindings", () => {
  /** SPEC §6: the two default configs are reflections, and six keys collide. */
  it("finds the six keys Config 1 and Config 2 disagree about", () => {
    expect(overlappingKeys(DEFAULT_BINDINGS.arrows, DEFAULT_BINDINGS.mirrored)).toHaveLength(6);
  });

  it("gives the third preset a key cluster disjoint from both others", () => {
    expect(overlappingKeys(DEFAULT_BINDINGS.rightCluster, DEFAULT_BINDINGS.arrows)).toEqual([]);
    expect(overlappingKeys(DEFAULT_BINDINGS.rightCluster, DEFAULT_BINDINGS.mirrored)).toEqual([]);
  });

  it("refuses a key another active human already holds", () => {
    store().setPlayerKind(1, "human");
    expect(store().setScheme(1, "mirrored")).toBe(true);

    // ArrowUp is Config 2's jump, and P2 is playing on Config 2.
    const result = store().rebind("arrows", "jump", "ArrowUp");

    expect(result.ok).toBe(false);
    expect(result.conflictPort).toBe(1);
    expect(result.conflictAction).toBe("jump");
    expect(store().bindings.arrows.jump).toBe(DEFAULT_BINDINGS.arrows.jump);
  });

  it("allows a key that only a CPU port's scheme happens to list", () => {
    // P2 is a CPU by default: it presses nothing, so it claims nothing.
    expect(store().players[1].kind).toBe("cpu");
    expect(store().rebind("arrows", "jump", "ArrowUp").ok).toBe(true);
    expect(store().bindings.arrows.jump).toBe("ArrowUp");
  });

  it("swaps rather than duplicates when one player rebinds onto their own key", () => {
    const oldJump = store().bindings.arrows.jump;
    const oldAttack = store().bindings.arrows.attack;

    expect(store().rebind("arrows", "jump", oldAttack).ok).toBe(true);
    expect(store().bindings.arrows.jump).toBe(oldAttack);
    expect(store().bindings.arrows.attack).toBe(oldJump);
  });

  it("stops two humans sharing one preset", () => {
    store().setPlayerKind(1, "human");
    expect(store().setScheme(1, "arrows")).toBe(false);
    expect(store().players[1].scheme).not.toBe("arrows");
  });

  it("restores a preset's defaults", () => {
    store().rebind("arrows", "grab", "KeyZ");
    expect(store().bindings.arrows.grab).toBe("KeyZ");

    store().resetBindings("arrows");
    expect(store().bindings.arrows).toEqual(DEFAULT_BINDINGS.arrows);
  });
});

/**
 * The accessor falls back to a stand-in roster when the real tables cannot be
 * loaded, which is exactly the kind of quiet substitution that lets a screen
 * look right while showing the wrong data. `live` is the flag that says which
 * one is on screen, and this asserts it is the real one — a shape change next
 * door turns up here rather than as eight fighters nobody recognises.
 */
describe("roster loading", () => {
  it("reads the real fighter and stage tables", async () => {
    const roster = await loadRoster();

    expect(roster.live).toBe(true);
    expect(roster.fighters.map((f) => f.id)).toContain("mario");
    expect(roster.stages.map((s) => s.id)).toContain("battlefield");
  });

  it("resolves all three forms of every stage from the stage module's own transform", async () => {
    const roster = await loadRoster();
    const smashville = roster.stages.find((s) => s.id === "smashville");

    expect(smashville).toBeDefined();
    // Ω is Final Destination's geometry: flat, no soft platforms at all.
    expect(smashville!.forms.omega.platforms.filter((p) => p.soft)).toHaveLength(0);
    // Battlefield form is Battlefield's: three of them.
    expect(smashville!.forms.battlefield.platforms.filter((p) => p.soft)).toHaveLength(3);
    // …and the stage's own layout is neither.
    expect(smashville!.forms.normal.platforms.filter((p) => p.soft)).toHaveLength(1);
  });

  it("orders the grid roster by fighter number", async () => {
    const numbers = (await loadRoster()).fighters.map((f) => f.number);
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
  });
});

describe("formatTime", () => {
  it("reads a frame count back as a clock", () => {
    expect(formatTime(60 * 60)).toBe("1:00");
    expect(formatTime(150 * 60)).toBe("2:30");
    expect(formatTime(0)).toBe("0:00");
  });
});
