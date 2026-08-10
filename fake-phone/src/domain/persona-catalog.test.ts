import { describe, expect, it } from "vitest";

import { getPersona, PERSONAS } from "@/domain/persona-catalog";
import { scriptDurationMs } from "@/domain/persona";

/** Every user-visible string in the catalog, flattened for the guard tests. */
function catalogText(): string {
  return PERSONAS.flatMap((persona) => [
    persona.title,
    persona.description,
    persona.suggestedCallerName,
    persona.suggestedCallerLabel,
    persona.characterBrief,
    ...persona.script.map((line) => line.text),
  ]).join("\n");
}

describe("persona catalog", () => {
  it("contains the default persona referenced by the settings schema", () => {
    // `settings.ts` defaults `personaId` to "friend-nearby". If this id is ever
    // renamed, every existing install silently falls back to another character.
    expect(PERSONAS.map((persona) => persona.id)).toContain("friend-nearby");
  });

  it("offers a real choice", () => {
    expect(PERSONAS.length).toBeGreaterThanOrEqual(5);
  });

  it("has unique ids", () => {
    const ids = PERSONAS.map((persona) => persona.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getPersona", () => {
  it("returns the requested persona", () => {
    expect(getPersona("parent-checkin").id).toBe("parent-checkin");
  });

  it("falls back to the first persona instead of throwing on an unknown id", () => {
    // Stored settings from an older build, or a persona deleted in a later one.
    // A safety app has to open into a ringing call either way.
    expect(() => getPersona("nope")).not.toThrow();
    expect(getPersona("nope")).toBe(PERSONAS[0]);
    expect(getPersona("").id).toBe(PERSONAS[0].id);
  });
});

describe("script shape", () => {
  it.each(PERSONAS.map((persona) => [persona.id, persona] as const))(
    "%s reads like one side of a real call",
    (_id, persona) => {
      // Eight lines is roughly the shortest a call can be and still feel like a
      // conversation rather than an announcement.
      expect(persona.script.length).toBeGreaterThanOrEqual(8);
      expect(persona.script.length).toBeLessThanOrEqual(14);

      for (const line of persona.script) {
        expect(line.text.trim()).not.toBe("");
        // Never a monologue: one side of a real call is short (§4.2).
        expect(line.text.split(/\s+/).length).toBeLessThanOrEqual(15);
        // The pause after every line is the illusion. A zero here would turn
        // the persona into a recording being read aloud.
        expect(line.pauseAfterMs).toBeGreaterThan(0);
        expect(line.pauseAfterMs).toBeGreaterThanOrEqual(1200);
        expect(line.pauseAfterMs).toBeLessThanOrEqual(3500);
      }

      // Varied, not a metronome — identical gaps read as machine-generated.
      const pauses = new Set(persona.script.map((line) => line.pauseAfterMs));
      expect(pauses.size).toBeGreaterThanOrEqual(4);

      expect(persona.characterBrief.length).toBeGreaterThan(80);
      expect(persona.suggestedCallerName.trim()).not.toBe("");
    },
  );

  it("gives every persona a call long enough to leave a room", () => {
    for (const persona of PERSONAS) {
      expect(scriptDurationMs(persona.script)).toBeGreaterThan(30_000);
    }
  });
});

describe("guardrails", () => {
  /**
   * SPEC §1.2: the app never claims, implies or simulates contact with
   * emergency services. This is a legal constraint before it is a policy one —
   * impersonating an officer or a dispatcher is a criminal offence in most
   * jurisdictions, and research/ai-voice-architecture.md §4.3 requires the same
   * rule be enforced by a keyword guard, not only by the prompt.
   */
  const EMERGENCY_TERMS =
    /\b(police|officer|constable|sheriff|cops?|911|999|112|emergency|dispatcher|dispatch|ambulance|paramedic|fire brigade|firefighter|law enforcement|first responder)\b/i;

  /**
   * SPEC §1.1: no prank/joke framing anywhere a store reviewer could read it.
   * App Store Guideline 1.1.6 bans prank-call apps outright and explicitly
   * refuses an "entertainment purposes" disclaimer as a defence.
   */
  const PRANK_TERMS = /\b(prank|joke|jokes|hoax|trick|tricks|fool|fooling|gag)\b/i;

  it("never mentions the emergency services anywhere in the catalog", () => {
    const match = catalogText().match(EMERGENCY_TERMS);
    expect(match?.[0] ?? null).toBeNull();
  });

  it("never frames a call as a prank", () => {
    const match = catalogText().match(PRANK_TERMS);
    expect(match?.[0] ?? null).toBeNull();
  });

  it("catches a persona that crossed the line", () => {
    // Proves the regex above can actually fail — a guard test that only ever
    // sees clean input is a test of nothing.
    expect("this is the police, open up").toMatch(EMERGENCY_TERMS);
    expect("call 911 now").toMatch(EMERGENCY_TERMS);
    expect("it's just a prank").toMatch(PRANK_TERMS);
  });
});
