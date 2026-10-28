import { beforeAll, describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { registryContext } from "@/engine/simulate";
import { bootstrapEngine } from "./bootstrap";
import { GAME_SIM_CONTEXT, engineFingerprint } from "./simContext";

beforeAll(() => {
  bootstrapEngine();
});

describe("the game's SimContext", () => {
  it("resolves fighters and stages from the registry", () => {
    expect(GAME_SIM_CONTEXT.fighter("mario")).toBe(registryContext.fighter("mario"));
    expect(GAME_SIM_CONTEXT.stage("battlefield")).toBe(registryContext.stage("battlefield"));
  });

  it("carries the root-bone table in Plan 2", () => {
    expect(GAME_SIM_CONTEXT.bones).toBe(LEGACY_BONE_TABLE);
  });

  it("fingerprints its bone table for online peers", () => {
    expect(engineFingerprint()).toBe(LEGACY_BONE_TABLE.fingerprint);
    expect(engineFingerprint()).toMatch(/^[0-9a-f]{8}$/);
    const other = { ...GAME_SIM_CONTEXT, bones: { ...LEGACY_BONE_TABLE, fingerprint: "0badf00d" } };
    expect(engineFingerprint(other)).toBe("0badf00d");
  });
});
