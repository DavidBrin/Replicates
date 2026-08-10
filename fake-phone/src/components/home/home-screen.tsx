"use client";

/**
 * The home surface — reached only by ending or declining the call.
 *
 * This is the one screen in fake-phone that is ours rather than a replica, and
 * it is designed to the opposite brief from the call screens: dark, quiet,
 * night-time, nothing that reads as an alarm. Someone opening this is either
 * preparing calmly in advance or has just stepped out of something unpleasant.
 * Amber, used almost nowhere except the button that matters, is a beacon rather
 * than a siren — and it keeps the surface clear of the red that would make the
 * app look like it contacts emergency services, which it must never imply
 * (SPEC §1.2).
 *
 * Two structural rules, both from research/competitive-teardown.md §4 Q3:
 *
 *  1. The primary action is the largest thing on screen and sits in the lower
 *     third, in a dock that never scrolls away — one-handed thumb reach, one
 *     tap, no hunting.
 *  2. Everything above it is configuration done *before* the moment of need.
 *     It may scroll; it may be ignored entirely, because the defaults already
 *     make a working call.
 *
 * The scroll lives on the inner container rather than the page: the app frame
 * is `position: fixed` (globals.css) so the document itself cannot scroll, and
 * `overscroll-contain` stops a flick at the end of the list from rubber-banding
 * the whole "phone".
 */

import { useRouter } from "next/navigation";

import { SettingsPanel } from "@/components/settings/settings-panel";
import { PrimaryButton } from "@/components/ui";

export function HomeScreen(): React.ReactElement {
  const router = useRouter();

  return (
    <div
      data-testid="home-screen"
      className="flex h-full w-full flex-col bg-ground text-text-primary"
    >
      <div className="pad-safe-top min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        <header className="pt-8 pb-6">
          <p className="flex items-center gap-2 text-[13px] font-medium tracking-tight text-text-secondary">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            fake-phone
          </p>

          <h1 className="mt-3 text-[19px] font-light lowercase tracking-[0.22em] text-text-primary">
            never feel alone
          </h1>

          {/*
            The honest description, in the exact words that would go in a store
            listing. "Prank", "joke", "trick" and "fool" appear nowhere in this
            product: Apple's Guideline 1.1.6 bans prank-call apps outright and
            explicitly refuses "for entertainment purposes" as a defence, and
            Google Play's Deceptive Behavior policy matches it
            (research/competitive-teardown.md §4 Q5). The framing is also simply
            true — the call is staged, it is yours, and it goes nowhere.
          */}
          <p className="mt-4 max-w-[34ch] text-[14px] leading-relaxed text-text-secondary">
            A staged incoming call on your own phone, set up in advance, for when you need a
            reason to step away or to look like someone knows where you are.
          </p>

          <p className="mt-2 max-w-[34ch] text-[12px] leading-relaxed text-text-secondary/70">
            Nothing is dialled and nobody is contacted. Ending the call brings you back here.
          </p>
        </header>

        <SettingsPanel />
      </div>

      {/*
        The dock. Fixed to the bottom of the frame so the primary action is
        always within thumb reach no matter how far the configuration above has
        been scrolled — the failure every competitor's reviewers describe is
        hunting for the trigger under stress, never a missing setting.
      */}
      <div className="pad-safe-bottom shrink-0 border-t border-hairline bg-ground px-5 pt-3 pb-3">
        <PrimaryButton onClick={() => router.push("/")} testId="start-call">
          Start a call
        </PrimaryButton>

        <PrimaryButton
          variant="secondary"
          onClick={() => router.push("/live")}
          testId="go-live"
          className="mt-2"
        >
          Go live
        </PrimaryButton>
      </div>
    </div>
  );
}
