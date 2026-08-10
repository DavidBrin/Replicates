"use client";

/**
 * The Android call skin — Material 3 Expressive, as shipped by Google Phone
 * v186+ (research/android-call-ui.md).
 *
 * A skin is a pure renderer over `CallSkinProps`: no state that outlives a
 * gesture, no timers, no knowledge of audio or personas. Everything below is
 * either a phase branch or a pixel decision.
 *
 * The three decisions that make this read as Android rather than as the iOS
 * skin with different colours:
 *
 *   1. **Shape is split.** Answer stays a circle; decline and end-call are
 *      stadium pills. Android Authority's teardown calls this out explicitly —
 *      the redesign moved end-call off a circular FAB onto a wide pill while
 *      the accept affordance kept its round icon treatment. On iOS both are
 *      identical circles, so this one split is the clearest tell in a
 *      screenshot (research §2.1).
 *   2. **Shape is stateful.** M3 Expressive treats corner radius as an animated
 *      property, not a token you pick once: the control buttons sit at
 *      `corner.full` and morph toward a rounded rectangle under the finger.
 *      Research §2.3 describes the morph running the other way (large → full);
 *      the 2025 teardowns describe what users actually see, which is oval at
 *      rest becoming a rounded rectangle when pressed, so that is what we
 *      animate.
 *   3. **Depth is tonal, not blurred.** Material signals elevation by shifting
 *      the surface colour (`surface` → `surfaceContainerHigh`), where iOS uses
 *      frosted glass. A `backdrop-filter` anywhere on this screen would be the
 *      wrong platform's idiom (research §4).
 */

import clsx from "clsx";
import type { ReactElement, ReactNode } from "react";

import { formatCallDurationAndroid, initialsFor } from "@/domain/format";

import { CALL_TEST_IDS, type CallSkinProps } from "../types";
import { CallEndIcon, DialpadIcon, MicIcon, MicOffIcon, MoreVertIcon, SpeakerIcon } from "./icons";
import { SwipeAnswerPill } from "./swipe-answer-pill";

export function AndroidCallSkin(props: CallSkinProps): ReactElement {
  const { phase } = props;

  return (
    <div
      data-testid={CALL_TEST_IDS.screen}
      data-skin="android"
      data-phase={phase}
      className="relative flex h-full w-full flex-col overflow-hidden bg-md-surface font-android text-md-on-surface"
    >
      {phase === "ringing" ? <IncomingCall {...props} /> : null}
      {phase === "connecting" || phase === "active" ? <InCall {...props} /> : null}
      {phase === "ended" ? <EndedCall {...props} /> : null}
      {/* `idle` renders the bare surface: the call has not arrived yet and the
          screen must not flash a control the user could hit by accident. */}
    </div>
  );
}

/* -------------------------------------------------------------- incoming -- */

function IncomingCall({
  callerName,
  callerLabel,
  photo,
  subtitle,
  onAnswer,
  onDecline,
}: CallSkinProps) {
  return (
    <div className="flex h-full flex-col">
      {/* No "call from <carrier>" line: the 2025 redesign removed it outright,
          and the space went to the photo and the name (research §1.2). */}
      <div className="pad-safe-top flex flex-1 flex-col items-center justify-center px-6 pt-14">
        <Avatar
          photo={photo}
          name={callerName}
          className="h-40 w-40"
          initialsClassName="text-[3.5rem]"
        />
        {/* displaySmall, 36/44 — "much larger contact names" per the teardown. */}
        <h1
          data-testid={CALL_TEST_IDS.callerName}
          className="mt-9 text-center text-[36px] leading-[44px] font-normal"
        >
          {callerName}
        </h1>
        {/* bodyLarge, 16/24 with 0.5 tracking. */}
        <p
          data-testid={CALL_TEST_IDS.callerLabel}
          className="mt-2 text-[16px] leading-6 tracking-[0.5px] text-md-on-surface-variant"
        >
          {callerLabel}
        </p>
        <Subtitle subtitle={subtitle} />
      </div>

      <SwipeAnswerPill onAnswer={onAnswer} onDecline={onDecline} />
    </div>
  );
}

/* --------------------------------------------------------------- in call -- */

function InCall({
  phase,
  callerName,
  callerLabel,
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
  return (
    <div className="flex h-full flex-col">
      <header className="pad-safe-top px-6 pt-12 text-center">
        <h1
          data-testid={CALL_TEST_IDS.callerName}
          className="text-[32px] leading-10 font-normal"
        >
          {callerName}
        </h1>
        <p
          data-testid={CALL_TEST_IDS.callerLabel}
          className="mt-1 text-[14px] leading-5 tracking-[0.25px] text-md-on-surface-variant"
        >
          {callerLabel}
        </p>
        {/* titleLarge, 22/28. Two-digit minutes: stock Dialer reads `MM:SS`, so
            the first tick is `00:01` where iOS would show `0:01` — the timer is
            the one place a skin can be caught out by a single character. */}
        <p
          data-testid={CALL_TEST_IDS.timer}
          className="tabular mt-3 text-[22px] leading-7 text-md-on-surface-variant"
        >
          {phase === "active" ? formatCallDurationAndroid(elapsedSeconds) : "Calling…"}
        </p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <Avatar
          photo={photo}
          name={callerName}
          className="h-32 w-32"
          initialsClassName="text-[2.75rem]"
        />
        <Subtitle subtitle={subtitle} />
      </div>

      <div className="pad-safe-bottom px-4 pb-4">
        {/* The 4-up primary row, in the order the 2023 bottom-sheet redesign
            fixed and Expressive kept: Keypad, Mute, Speaker, More. */}
        <div className="mb-4 grid grid-cols-4 gap-3">
          <ControlButton
            testId={CALL_TEST_IDS.keypad}
            label="Keypad"
            active={keypadOpen}
            onClick={onToggleKeypad}
            icon={<DialpadIcon className="h-6 w-6" />}
          />
          <ControlButton
            testId={CALL_TEST_IDS.mute}
            label={muted ? "Unmute" : "Mute"}
            active={muted}
            onClick={onToggleMute}
            icon={muted ? <MicOffIcon className="h-6 w-6" /> : <MicIcon className="h-6 w-6" />}
          />
          <ControlButton
            testId={CALL_TEST_IDS.speaker}
            label="Speaker"
            active={speaker}
            onClick={onToggleSpeaker}
            icon={<SpeakerIcon className="h-6 w-6" />}
          />
          {/* "More" opens Hold / Add call / Video call on a real phone. The skin
              contract has no callback for any of them and inventing one would
              put call state in a renderer, so the button is present for the
              shape of the row and marked unavailable rather than left silently
              dead under a finger. */}
          <ControlButton
            label="More options"
            unavailable
            icon={<MoreVertIcon className="h-6 w-6" />}
          />
        </div>

        {/* The end-call pill: wide, stadium, hard against the bottom safe area.
            Height and radius are the shape claim — a circle here would be the
            iOS screen wearing Android's colours. */}
        <button
          type="button"
          data-testid={CALL_TEST_IDS.hangUp}
          aria-label="End call"
          onClick={onHangUp}
          className="flex h-[68px] w-full items-center justify-center rounded-full bg-md-decline text-white transition-[border-radius] duration-200 ease-md-emphasized active:rounded-[24px]"
        >
          <CallEndIcon className="h-8 w-8" />
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- ended -- */

/**
 * Deliberately plain and deliberately brief. The controller navigates away a
 * moment after the call ends; this frame exists so the screen does not blink
 * from a live call to a settings page with nothing in between.
 */
function EndedCall({ callerName, callerLabel, photo, elapsedSeconds, subtitle }: CallSkinProps) {
  return (
    <div className="pad-safe-top pad-safe-bottom flex h-full flex-col items-center justify-center gap-3 px-6">
      <Avatar
        photo={photo}
        name={callerName}
        className="h-28 w-28"
        initialsClassName="text-[2.5rem]"
      />
      <h1 data-testid={CALL_TEST_IDS.callerName} className="mt-4 text-[28px] leading-9">
        {callerName}
      </h1>
      <p
        data-testid={CALL_TEST_IDS.callerLabel}
        className="text-[14px] leading-5 tracking-[0.25px] text-md-on-surface-variant"
      >
        {callerLabel}
      </p>
      <p
        data-testid={CALL_TEST_IDS.timer}
        className="tabular text-[16px] leading-6 text-md-on-surface-variant"
      >
        {formatCallDurationAndroid(elapsedSeconds)}
      </p>
      <p className="text-[14px] leading-5 tracking-[0.1px] text-md-on-surface-variant">Call ended</p>
      <Subtitle subtitle={subtitle} />
    </div>
  );
}

/* ----------------------------------------------------------------- parts -- */

interface ControlButtonProps {
  readonly testId?: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly unavailable?: boolean;
}

/**
 * One of the 4-up controls: an oval at rest that morphs toward a rounded
 * rectangle while pressed.
 *
 * The morph is a `border-radius` transition on `:active` with M3's
 * emphasized-decelerate curve. Real Expressive components run a spring, which
 * CSS cannot express as a timing function; the emphasized approximation is the
 * documented fallback for single-curve systems and is what the token in
 * globals.css holds (research §4).
 */
function ControlButton({ testId, label, icon, active, onClick, unavailable }: ControlButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      // A real string attribute, not a class: `aria-pressed` is how a toggle
      // announces itself, and it is what the e2e suite reads to know the tap
      // landed.
      aria-pressed={unavailable ? undefined : Boolean(active)}
      aria-disabled={unavailable ? true : undefined}
      onClick={onClick}
      className={clsx(
        "flex h-16 w-full items-center justify-center rounded-full transition-[border-radius,background-color,color] duration-200 ease-md-emphasized active:rounded-[18px]",
        active
          ? "bg-md-primary text-md-surface"
          : "bg-md-surface-container-high text-md-on-surface",
      )}
    >
      {icon}
    </button>
  );
}

interface AvatarProps {
  readonly photo: string;
  readonly name: string;
  readonly className: string;
  readonly initialsClassName: string;
}

/**
 * Photo, or a filled tonal circle carrying the initials.
 *
 * Android's no-photo fallback is a *filled* circle — iOS's is a translucent
 * glyph over the gradient background, so copying the iOS treatment here is a
 * mistake that survives a long time because both look plausible in isolation.
 */
function Avatar({ photo, name, className, initialsClassName }: AvatarProps) {
  if (photo) {
    // The photo is a user-supplied data/object URL held in local settings:
    // there is no origin for next/image to optimise and no network fetch to
    // defer, so the plain element is the correct one here.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        className={clsx("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-full bg-md-surface-container-high",
        className,
      )}
    >
      <span className={clsx("font-normal text-md-on-surface", initialsClassName)}>
        {initialsFor(name)}
      </span>
    </div>
  );
}

/**
 * The caller's current line, rendered as text.
 *
 * This is not a decoration: speech synthesis on iOS Safari is unreliable enough
 * that the scripted voice tier degrades to subtitles (SPEC §4), so on those
 * devices this element *is* the conversation.
 */
function Subtitle({ subtitle }: { readonly subtitle: string | null }) {
  if (subtitle === null) return null;
  return (
    <p
      data-testid={CALL_TEST_IDS.subtitle}
      aria-live="polite"
      className="mt-6 max-w-[22rem] text-center text-[16px] leading-6 tracking-[0.5px] text-md-on-surface-variant"
    >
      {subtitle}
    </p>
  );
}
