/**
 * The incoming-call screen (research/ios-call-ui.md §1).
 *
 * The layout is the point. Since iOS 17 everything is pushed to the bottom in
 * two stacked rows — a small labelled secondary row above the large icon-only
 * Decline/Accept pair — and the pre-2023 centred single row is the single most
 * common replica mistake (§7.1). Name and label sit in the upper third, over the
 * poster, with nothing between them and the buttons.
 */

import type { CallSkinProps } from "../types";
import { CALL_TEST_IDS } from "../types";

import { IncomingBackground } from "./background";
import { SubtitleCaption } from "./caption";
import { CircleAction, SecondaryAction } from "./controls";
import { AlarmIcon, HandsetDownIcon, HandsetIcon, MessageIcon } from "./icons";

export function IncomingScreen({
  callerName,
  callerLabel,
  photo,
  subtitle,
  onAnswer,
  onDecline,
}: CallSkinProps) {
  return (
    <div className="relative flex h-full w-full flex-col">
      <IncomingBackground photo={photo} callerName={callerName} />

      <div className="pad-safe-top relative z-10">
        {/* ~88pt below the safe-area inset puts the name in the upper third on
         * a Dynamic-Island phone (research/ios-call-ui.md §1.4). */}
        <div className="px-8 pt-[88px] text-center">
          <h1
            data-testid={CALL_TEST_IDS.callerName}
            className="text-[30px] leading-tight font-semibold text-white"
            // Shadow rather than a top scrim: real iOS keeps the poster clean at
            // the top and leans on the type for contrast (§1.4).
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.35)" }}
          >
            {callerName}
          </h1>
          <p
            data-testid={CALL_TEST_IDS.callerLabel}
            className="mt-1 text-[17px] font-normal text-white/80"
          >
            {callerLabel}
          </p>
        </div>
      </div>

      <div className="relative z-10 mt-auto">
        {subtitle === null ? null : <SubtitleCaption text={subtitle} />}

        <div className="pad-safe-bottom">
          {/* The two rows are one block ~44pt above the safe-area inset (§1.6).
           * `pad-safe-bottom` is a plain class, so it has to sit on its own
           * element or it would fight this padding in the cascade. */}
          <div className="flex flex-col gap-8 pb-[44px]">
            <div className="grid grid-cols-2 justify-items-center px-4">
              <SecondaryAction label="Message" icon={<MessageIcon className="h-6 w-6" />} />
              <SecondaryAction label="Remind Me" icon={<AlarmIcon className="h-6 w-6" />} />
            </div>

            {/* Two columns rather than a flex row with a gap: it fixes the
             * circles near the left/right thirds at every screen width, which is
             * the spacing the real pair has (§1.6). */}
            <div className="grid grid-cols-2 justify-items-center px-4">
              <CircleAction
                testId={CALL_TEST_IDS.decline}
                label="Decline call"
                onClick={onDecline}
                className="h-[80px] w-[80px] bg-ios-red"
                icon={<HandsetDownIcon className="h-8 w-8" />}
              />
              <CircleAction
                testId={CALL_TEST_IDS.answer}
                label="Answer call"
                onClick={onAnswer}
                className="h-[80px] w-[80px] bg-ios-green"
                icon={<HandsetIcon className="h-8 w-8" />}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
