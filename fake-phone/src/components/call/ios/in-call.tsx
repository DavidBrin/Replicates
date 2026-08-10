/**
 * The connecting / active / ended screen (research/ios-call-ui.md §2).
 *
 * Name and timer at the top, a frosted 3×2 control grid in the lower middle, and
 * the red end-call circle alone below it. All three phases share this layout on
 * purpose: "connecting…", the running timer and "Call ended" swap in the same
 * slot, so nothing on screen moves as the call progresses. A layout that
 * reflowed when the timer appeared would be the tell.
 */

import { formatCallDuration } from "@/domain/format";

import type { CallSkinProps } from "../types";
import { CALL_TEST_IDS } from "../types";

import { InCallBackground } from "./background";
import { SubtitleCaption } from "./caption";
import { CircleAction, GlassControl } from "./controls";
import {
  HandsetDownIcon,
  KeypadIcon,
  MicIcon,
  MicSlashIcon,
  PersonCircleIcon,
  PersonPlusIcon,
  SpeakerWavesIcon,
  VideoIcon,
} from "./icons";
import { IOS_TEST_IDS } from "./ids";

export function InCallScreen({
  phase,
  callerName,
  photo,
  elapsedSeconds,
  muted,
  speaker,
  keypadOpen,
  subtitle,
  onHangUp,
  onToggleMute,
  onToggleSpeaker,
  onToggleKeypad,
}: CallSkinProps) {
  const ended = phase === "ended";
  // The state machine only accepts toggles while `active`, so anything else is
  // shown but not offered — the alternative is a control that silently ignores
  // the tap.
  const togglesLive = phase === "active";

  return (
    <div className="relative flex h-full w-full flex-col">
      <InCallBackground photo={photo} />

      <div className="pad-safe-top relative z-10">
        <div className="px-8 pt-[64px] text-center">
          <h1
            data-testid={CALL_TEST_IDS.callerName}
            className="text-[28px] leading-tight font-semibold text-white"
          >
            {callerName}
          </h1>
          <CallStatus phase={phase} elapsedSeconds={elapsedSeconds} />
        </div>
      </div>

      <div className="relative z-10 mt-auto">
        {subtitle === null ? null : <SubtitleCaption text={subtitle} />}

        <div className="pad-safe-bottom">
          <div className="flex flex-col items-center gap-9 pb-[40px]">
            <div
              data-testid={IOS_TEST_IDS.controlGrid}
              className={`grid grid-cols-3 gap-x-[26px] gap-y-[22px] ${ended ? "opacity-50" : ""}`}
            >
              <GlassControl
                testId={CALL_TEST_IDS.mute}
                label={muted ? "Unmute" : "Mute"}
                active={muted}
                disabled={!togglesLive}
                onClick={onToggleMute}
                icon={muted ? <MicSlashIcon className="h-7 w-7" /> : <MicIcon className="h-7 w-7" />}
              />
              <GlassControl
                testId={CALL_TEST_IDS.keypad}
                label="Keypad"
                active={keypadOpen}
                disabled={!togglesLive}
                onClick={onToggleKeypad}
                icon={<KeypadIcon className="h-7 w-7" />}
              />
              <GlassControl
                testId={CALL_TEST_IDS.speaker}
                label="Speaker"
                active={speaker}
                disabled={!togglesLive}
                onClick={onToggleSpeaker}
                icon={<SpeakerWavesIcon className="h-7 w-7" />}
              />
              {/* Row two is the real screen's add-call / FaceTime / contacts.
               * Inert: see `SecondaryAction` in ./controls. */}
              <GlassControl label="Add call" icon={<PersonPlusIcon className="h-7 w-7" />} />
              <GlassControl label="FaceTime" icon={<VideoIcon className="h-7 w-7" />} />
              <GlassControl label="Contacts" icon={<PersonCircleIcon className="h-7 w-7" />} />
            </div>

            {/* Bottom-centre, and larger than the grid cells. Apple tried
             * bottom-right during the iOS 17 betas and reverted before GA
             * (research/ios-call-ui.md §2.4). */}
            <CircleAction
              testId={CALL_TEST_IDS.hangUp}
              label="End call"
              onClick={onHangUp}
              disabled={ended}
              className="h-[80px] w-[80px] bg-ios-red"
              icon={<HandsetDownIcon className="h-8 w-8" />}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The line under the name. Only the running timer carries the timer test id —
 * "connecting…" is not a duration, and an e2e that waited on the id would
 * otherwise pass before the call had connected.
 */
function CallStatus({
  phase,
  elapsedSeconds,
}: Pick<CallSkinProps, "phase" | "elapsedSeconds">) {
  if (phase === "connecting") {
    return (
      <p
        data-testid={IOS_TEST_IDS.status}
        className="mt-1.5 text-[17px] font-normal text-white/80"
      >
        connecting…
      </p>
    );
  }

  if (phase === "ended") {
    return (
      <p
        data-testid={IOS_TEST_IDS.status}
        className="mt-1.5 text-[17px] font-normal text-white/80"
      >
        Call ended
      </p>
    );
  }

  return (
    <p
      data-testid={CALL_TEST_IDS.timer}
      // `tabular` stops the width jitter as digits change; the format itself is
      // `0:01` and not `00:01` (research/ios-call-ui.md §2.2).
      className="tabular mt-1.5 text-[17px] font-normal text-white/80"
    >
      {formatCallDuration(elapsedSeconds)}
    </p>
  );
}
