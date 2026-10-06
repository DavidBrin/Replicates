/**
 * The persona roster names (ours, not SMG's).
 *
 * This suite lives in `src/content/` rather than beside the personas in `src/engine/bots/`, because
 * `content` is a banned layer for anything under `src/engine/**` and the T1 layering guard applies
 * that ban to engine test files too (`layering.test.ts`'s scan exempts only bare package imports in
 * tests, never a sibling layer). The display names are presentation, the engine key is the stable
 * identity, and the dependency runs one way: this file reads `@/engine/bots`, never the reverse.
 */

import { describe, expect, it } from "vitest";

import { PERSONAS } from "@/engine/bots";

import { PERSONA_NAMES, personaBlurb, personaDisplayName } from "./personaNames";

describe("content/personaNames", () => {
  it("names all eight personas, and exactly those", () => {
    expect(Object.keys(PERSONA_NAMES).sort()).toEqual(Object.keys(PERSONAS).sort());
  });

  it("uses none of SMG's own persona names", () => {
    // Theirs: Aggressive, Continental, Stacker, Defensive, Friendly. Recorded in the spec as
    // provenance; never shipped as a label.
    const theirs = ["aggressive", "continental", "stacker", "defensive", "friendly"];
    for (const display of Object.values(PERSONA_NAMES)) {
      expect(theirs).not.toContain(display.name.toLowerCase());
    }
  });

  it("every name is distinct", () => {
    const names = Object.values(PERSONA_NAMES).map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every blurb is a single line of real text", () => {
    for (const display of Object.values(PERSONA_NAMES)) {
      expect(display.blurb).not.toContain("\n");
      expect(display.blurb.length).toBeGreaterThan(10);
      expect(display.blurb.trim()).toBe(display.blurb);
    }
  });

  it("falls back to the engine key rather than rendering blank", () => {
    expect(personaDisplayName("rusher")).toBe("Vanguard");
    expect(personaDisplayName("nope")).toBe("nope");
    expect(personaBlurb("nope")).toBe("");
  });

  it("the engine key is what identifies a persona, so a rename cannot move a golden hash (D55)", () => {
    // The engine's own `BotPersona.name` values stay the lowercase keys.
    for (const [key, persona] of Object.entries(PERSONAS)) {
      expect(persona.name).toBe(key);
      expect(PERSONA_NAMES[key]?.name).not.toBe(key);
    }
  });
});
