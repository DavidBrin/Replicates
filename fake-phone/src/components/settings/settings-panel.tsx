"use client";

/**
 * Every setting, in the order someone actually configures them.
 *
 * Caller first (it decides whether the screen reads as real), then voice, then
 * timing, then the cosmetic and mode-specific groups. Nothing here is required
 * — the defaults are a working call — so the surface can be scrolled past
 * entirely on the way to the button underneath it.
 *
 * All of this is preparation. The product insight the whole app is built on is
 * that configuration happens *before* the moment of need and activation is one
 * tap (research/competitive-teardown.md §4 Q3): nobody types a caller's name
 * while a stranger is following them.
 */

import clsx from "clsx";

import { useSettings } from "@/components/app-shell/settings-provider";
import { PrimaryButton } from "@/components/ui";

import { CallerSection } from "./caller-section";
import { LiveSection } from "./live-section";
import { LookSection } from "./look-section";
import { SoundSection } from "./sound-section";
import { TimingSection } from "./timing-section";
import { VoiceSection } from "./voice-section";

export function SettingsPanel() {
  const { reset, hydrated } = useSettings();

  return (
    <div
      data-testid="settings-panel"
      // Stored settings arrive one tick after the first paint (localStorage
      // cannot be read during render without breaking hydration), so the panel
      // fades in rather than flashing the defaults and then correcting itself.
      // `aria-busy` says the same thing to a screen reader.
      aria-busy={!hydrated}
      // And it is genuinely inert until then, not merely invisible. Before
      // hydration these are server-rendered inputs with no React listeners
      // attached: a keystroke that lands in that window changes the DOM, is
      // never seen by any handler, and is then silently wiped when React
      // hydrates and re-asserts the controlled value. Refusing the edit is
      // honest; accepting one we are about to throw away is not.
      inert={!hydrated}
      className={clsx(
        "flex flex-col gap-3 transition-opacity duration-200",
        hydrated ? "opacity-100" : "opacity-0",
      )}
    >
      <CallerSection />
      <VoiceSection />
      <TimingSection />
      <LookSection />
      <SoundSection />
      <LiveSection />

      <div className="pt-1 pb-2">
        <PrimaryButton variant="quiet" onClick={reset} testId="setting-reset">
          Reset to defaults
        </PrimaryButton>
      </div>
    </div>
  );
}
