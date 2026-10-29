import { beforeAll, describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { ENGINE_RULES_VERSION } from "@/engine/constants";
import { registryContext } from "@/engine/simulate";
import { FIGHTERS } from "@/fighters";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";
import { bootstrapEngine } from "./bootstrap";
import { GAME_ENGINE_RULES, GAME_SIM_CONTEXT, engineFingerprint, rulesFingerprint } from "./simContext";

beforeAll(() => {
  bootstrapEngine();
});

describe("the game's SimContext", () => {
  it("resolves fighters and stages from the registry", () => {
    expect(GAME_SIM_CONTEXT.fighter("mario")).toBe(registryContext.fighter("mario"));
    expect(GAME_SIM_CONTEXT.stage("battlefield")).toBe(registryContext.stage("battlefield"));
  });

  it("carries the root-bone table until the bake is installed", () => {
    expect(GAME_SIM_CONTEXT.bones).toBe(LEGACY_BONE_TABLE);
  });

  it("fingerprints its bone table for online peers", () => {
    expect(engineFingerprint()).toMatch(/^[0-9a-f]{8}$/);
    const other = { ...GAME_SIM_CONTEXT, bones: { ...LEGACY_BONE_TABLE, fingerprint: "0badf00d" } };
    expect(engineFingerprint(other)).not.toBe(engineFingerprint());
  });

  // Plan 3, Task 20: two builds with the same bones but different combat rules,
  // or a different set of running scripts, are different games too.
  it("fingerprints the engine's rules version and the scripts that run", () => {
    const base = engineFingerprint();
    expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION + 1, activeSlots: ACTIVE_SCRIPT_SLOTS })).not.toBe(base);
    const fewer = { ...ACTIVE_SCRIPT_SLOTS, mario: ACTIVE_SCRIPT_SLOTS.mario.slice(1) };
    expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION, activeSlots: fewer })).not.toBe(base);
    expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION, activeSlots: ACTIVE_SCRIPT_SLOTS })).toBe(base);
  });

  // The online stamp carries the rules' part on its own, so a refusal can say
  // which half differs. It takes no bone table, so it cannot move with one.
  it("fingerprints the rules alone, apart from the bone table", () => {
    const rules = rulesFingerprint();
    expect(rules).toMatch(/^[0-9a-f]{8}$/);
    expect(rulesFingerprint(GAME_ENGINE_RULES)).toBe(rules);
    expect(rulesFingerprint({ version: ENGINE_RULES_VERSION + 1, activeSlots: ACTIVE_SCRIPT_SLOTS })).not.toBe(rules);
    const fewer = { ...ACTIVE_SCRIPT_SLOTS, mario: ACTIVE_SCRIPT_SLOTS.mario.slice(1) };
    expect(rulesFingerprint({ version: ENGINE_RULES_VERSION, activeSlots: fewer })).not.toBe(rules);
    // Which slot, not only how many: one swapped for another of the same count.
    const swapped = { ...ACTIVE_SCRIPT_SLOTS, mario: [...ACTIVE_SCRIPT_SLOTS.mario.slice(1), "nair" as const] };
    expect(swapped.mario).toHaveLength(ACTIVE_SCRIPT_SLOTS.mario.length);
    expect(rulesFingerprint({ version: ENGINE_RULES_VERSION, activeSlots: swapped })).not.toBe(rules);
    // A slot is its fighter's: the same slot under another fighter is another set.
    const moved = { ...ACTIVE_SCRIPT_SLOTS, mario: [], donkeyKong: [...ACTIVE_SCRIPT_SLOTS.donkeyKong, ...ACTIVE_SCRIPT_SLOTS.mario] };
    expect(rulesFingerprint({ version: ENGINE_RULES_VERSION, activeSlots: moved })).not.toBe(rules);
  });

  it("counts a fighter with no active slot as not listed", () => {
    expect(rulesFingerprint({ version: ENGINE_RULES_VERSION, activeSlots: { ...ACTIVE_SCRIPT_SLOTS, ganondorf: [] } })).toBe(rulesFingerprint());
  });

  it("says the same for the same set of slots in any order", () => {
    const reversed = Object.fromEntries(
      Object.entries(ACTIVE_SCRIPT_SLOTS)
        .reverse()
        .map(([id, slots]) => [id, [...slots].reverse()]),
    );
    expect(rulesFingerprint({ version: ENGINE_RULES_VERSION, activeSlots: reversed })).toBe(rulesFingerprint());
    expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION, activeSlots: reversed })).toBe(engineFingerprint());
  });

  /**
   * The slots the stamp names are the slots the registered fighters run from
   * imported scripts: a fighter built with a script the table does not list, or
   * the table naming one no fighter runs, would leave the fingerprint saying
   * something the engine does not do.
   */
  it("names exactly the slots the roster runs from imported scripts", () => {
    const running = Object.fromEntries(
      FIGHTERS.map((def) => [def.id, Object.keys(def.scripts ?? {}).sort()] as const).filter(([, slots]) => slots.length > 0),
    );
    const named = Object.fromEntries(Object.entries(GAME_ENGINE_RULES.activeSlots).map(([id, slots]) => [id, [...slots].sort()]));
    expect(Object.keys(running).length).toBeGreaterThan(0);
    expect(named).toEqual(running);
    expect(GAME_ENGINE_RULES.version).toBe(ENGINE_RULES_VERSION);
  });
});
