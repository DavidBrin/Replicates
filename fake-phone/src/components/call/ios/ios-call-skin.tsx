"use client";

/**
 * The iOS skin: a pure renderer over `CallSkinProps` (SPEC §2.4).
 *
 * It holds no state, starts no timers and knows nothing about audio or personas
 * — every phase below is a function of the props it was handed, which is what
 * lets the whole screen be tested without a browser and lets the Android skin
 * stay behaviourally identical while looking nothing like this.
 */

import type { ReactElement } from "react";

import { CALL_TEST_IDS, type CallSkinProps } from "../types";

import { IncomingBackground } from "./background";
import { InCallScreen } from "./in-call";
import { IncomingScreen } from "./incoming";

export function IosCallSkin(props: CallSkinProps): ReactElement {
  const { phase, callerName, photo } = props;

  return (
    <div
      data-testid={CALL_TEST_IDS.screen}
      data-skin="ios"
      data-phase={phase}
      // `h-full w-full`, never a viewport unit: the parent is already the fixed
      // `.app-frame` that solved `100dvh`, and a second viewport-sized box
      // inside it re-opens the bug where the end-call button sits under the
      // mobile-Safari URL bar.
      className="font-ios relative h-full w-full overflow-hidden bg-black text-white"
    >
      {phase === "idle" ? (
        // Pre-ring. The poster is already on screen so that the moment the call
        // starts ringing nothing loads, flashes or reflows — only the buttons
        // arrive.
        <IncomingBackground photo={photo} callerName={callerName} />
      ) : phase === "ringing" ? (
        <IncomingScreen {...props} />
      ) : (
        <InCallScreen {...props} />
      )}
    </div>
  );
}
