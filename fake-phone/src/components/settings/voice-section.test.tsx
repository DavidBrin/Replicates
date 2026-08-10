/**
 * The AI tier's two states, as the settings screen presents them.
 *
 * `settings-panel.test.tsx` covers the shipped (unlit) state as part of the
 * whole panel. What is tested here is the thing that was broken: the option was
 * hard-coded inert, so on a build that followed README "Enabling the AI tier" to
 * the letter — key set, `NEXT_PUBLIC_VOICE_AI_ENABLED=true`, rebuilt — step 5
 * ("choose the AI voice tier in settings") could not be carried out at all.
 *
 * The flag is read at render, so `vi.stubEnv` is enough to exercise both states.
 * In a real build Next inlines it, which is why the component compares a literal.
 */

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithSettings } from "./settings-test-harness";
import { VoiceSection } from "./voice-section";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VoiceSection — the AI tier on a default build", () => {
  it("shows the option, refuses the selection, and says why", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_AI_ENABLED", "");
    const { store, user } = renderWithSettings(<VoiceSection />);

    const ai = screen.getByTestId("setting-voice-tier-ai");
    expect(ai).toBeVisible();
    expect(ai).toHaveAttribute("aria-disabled", "true");

    await user.click(ai);

    expect(store.load().voiceTier).toBe("scripted");
    // The e2e suite reads this block for both words; keep them both.
    expect(screen.getByTestId("setting-voice-tier")).toHaveTextContent(/AI/i);
    expect(screen.getByTestId("setting-voice-tier")).toHaveTextContent(/key/i);
  });

  it("is inert for every value other than the exact string 'true'", () => {
    for (const value of ["false", "1", "yes", "TRUE"]) {
      vi.stubEnv("NEXT_PUBLIC_VOICE_AI_ENABLED", value);
      const { unmount } = renderWithSettings(<VoiceSection />);
      expect(screen.getByTestId("setting-voice-tier-ai")).toHaveAttribute("aria-disabled", "true");
      unmount();
    }
  });
});

describe("VoiceSection — the AI tier on a build that enabled it", () => {
  it("lets the tier actually be chosen", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_AI_ENABLED", "true");
    const { store, user } = renderWithSettings(<VoiceSection />);

    const ai = screen.getByTestId("setting-voice-tier-ai");
    expect(ai).not.toHaveAttribute("aria-disabled");

    await user.click(ai);

    expect(store.load().voiceTier).toBe("ai");
    expect(ai).toHaveAttribute("aria-checked", "true");
  });

  it("still names the key, because the server is the real authority", () => {
    // Flag on, key missing: the routes answer 503 and the call falls back to the
    // scripted voice. Promising a working AI call here would be the false
    // information the greyed-out state exists to avoid.
    vi.stubEnv("NEXT_PUBLIC_VOICE_AI_ENABLED", "true");
    renderWithSettings(<VoiceSection />);

    const note = screen.getByTestId("setting-voice-tier-ai-note");
    expect(note).toHaveTextContent(/key/i);
    expect(note).toHaveTextContent(/scripted/i);
  });
});
