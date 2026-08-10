"use client";

/**
 * The horizontal swipe pill — Google Phone's current incoming-call control.
 *
 * Android has shipped three different answer interactions (research/
 * android-call-ui.md §1.1): the legacy vertical drag, a short-lived iOS-style
 * pair of circular buttons, and — as the production default since the Material
 * 3 Expressive rollout, Phone v186+ — this one: a single stadium bar with
 * "Decline" in red on the left, "Answer" in green on the right, and a handset
 * icon in the middle that you drag toward one or the other. Google's stated
 * reason for moving off swipe-up/swipe-down is pocket-dialling, which is the
 * same reason it belongs here: fake-phone is used one-handed, in a pocket, under
 * stress, and an accidental answer is a wasted rescue.
 *
 * Two things are load-bearing about the implementation:
 *
 *   1. The gesture is real. A pill you can only tap looks like the screenshot
 *      but feels like a mock, and the drag is the single most recognisable
 *      thing about the current Android call screen.
 *   2. The gesture is never the *only* way through. Both halves are real
 *      `<button>`s carrying the shared test ids, so a plain click answers or
 *      declines. That keeps the screen operable by keyboard, by assistive tech,
 *      and by one Playwright suite that drives both skins identically — and it
 *      means a user whose drag does not register still gets out of the call.
 */

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { CALL_TEST_IDS } from "../types";
import { CallIcon } from "./icons";

/** 56dp handle inside a 72dp bar, per the M3 touch-target scale. */
const HANDLE_PX = 56;
const TRACK_INSET_PX = 8;

/**
 * Used until the bar has been measured — and in jsdom, which has no layout
 * engine at all, so `getBoundingClientRect()` there is permanently zero.
 * Without a floor the threshold would be 0 and the very first pointermove would
 * answer the call.
 */
const FALLBACK_TRAVEL_PX = 120;

/** Past 60% of the available travel the handle snaps home; short of it, it springs back. */
const SNAP_FRACTION = 0.6;

/** Below this, a pointer sequence is a tap and not a drag. */
const DRAG_SLOP_PX = 6;

/**
 * The red/green labels settle to a neutral colour about a second in and light
 * back up mid-swipe (research/android-call-ui.md §1.1c). It reads as the bar
 * calming down once you have noticed it, then confirming your intent.
 */
const SETTLE_MS = 1000;

export interface SwipeAnswerPillProps {
  readonly onAnswer: () => void;
  readonly onDecline: () => void;
}

export function SwipeAnswerPill({ onAnswer, onDecline }: SwipeAnswerPillProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [travel, setTravel] = useState(FALLBACK_TRAVEL_PX);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settled, setSettled] = useState(false);

  const startXRef = useRef(0);
  const offsetRef = useRef(0);
  /** True once a pointer sequence has travelled far enough to be a drag. */
  const movedRef = useRef(false);

  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;

    const measure = () => {
      const usable =
        (element.getBoundingClientRect().width - HANDLE_PX) / 2 -
        TRACK_INSET_PX;
      setTravel(usable > 0 ? usable : FALLBACK_TRAVEL_PX);
    };

    measure();
    // Rotation and the mobile URL bar both resize the bar under us; a stale
    // travel figure would leave the handle able to slide past its own track.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, []);

  /**
   * Move and release are bound to the window rather than captured on the track.
   * `setPointerCapture` would be the obvious choice, but an active capture
   * retargets the subsequent `click` to the capturing element, which would stop
   * a plain click ever reaching the Answer/Decline buttons — the exact path the
   * e2e suite depends on. Window listeners keep click targeting normal and still
   * follow a finger that leaves the bar.
   */
  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent) => {
      const raw = event.clientX - startXRef.current;
      const dx = Math.max(-travel, Math.min(travel, raw));
      if (Math.abs(dx) > DRAG_SLOP_PX) movedRef.current = true;
      offsetRef.current = dx;
      setOffset(dx);
    };

    const onEnd = () => {
      const dx = offsetRef.current;
      setDragging(false);
      if (dx >= travel * SNAP_FRACTION) {
        setOffset(travel);
        onAnswer();
        return;
      }
      if (dx <= -travel * SNAP_FRACTION) {
        setOffset(-travel);
        onDecline();
        return;
      }
      offsetRef.current = 0;
      setOffset(0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [dragging, travel, onAnswer, onDecline]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button > 0) return;
      startXRef.current = event.clientX;
      offsetRef.current = 0;
      movedRef.current = false;
      setOffset(0);
      setDragging(true);
    },
    [],
  );

  /**
   * A drag that ends over a half also fires that half's `click`. Swallowing the
   * click after a real drag is what stops "drag right to answer" from answering
   * twice — which, on a state machine that ignores the second one, would be
   * harmless today and a duplicate side effect the moment anything downstream
   * stops being idempotent.
   */
  const tapGuard = useCallback(
    (action: () => void) => () => {
      if (movedRef.current) {
        movedRef.current = false;
        return;
      }
      action();
    },
    [],
  );

  const intent =
    offset > DRAG_SLOP_PX
      ? "answer"
      : offset < -DRAG_SLOP_PX
        ? "decline"
        : null;
  const declineLit = !settled || intent === "decline";
  const answerLit = !settled || intent === "answer";

  return (
    // The safe-area inset and the 24px gap must sit on *separate* elements.
    // `.pad-safe-bottom` is unlayered CSS and Tailwind's `pb-6` is in
    // `@layer utilities`, so putting both on one element lets the unlayered rule
    // win outright — and on any device without a home indicator (every Android,
    // every desktop) that inset is 0, so the pill ends up flush against the
    // bottom edge with no gap at all.
    <div className="pad-safe-bottom">
      <div className="px-4 pb-6">
        {/* `fp-android-ring` is defined in globals.css alongside the other
          non-utility CSS; `prefers-reduced-motion` there neutralises it. */}
        <div
          ref={trackRef}
          data-testid="android-swipe-track"
          onPointerDown={handlePointerDown}
          className="relative flex h-[72px] touch-none items-center overflow-hidden rounded-full bg-md-surface-container-high"
        >
          <button
            type="button"
            data-testid={CALL_TEST_IDS.decline}
            aria-label="Decline"
            onClick={tapGuard(onDecline)}
            className={clsx(
              // labelLarge, 14/20 with 0.1 tracking (research §3.1).
              "h-full flex-1 touch-none pl-7 text-left text-[14px] leading-5 font-medium tracking-[0.1px] transition-colors duration-300 ease-md-emphasized",
              declineLit ? "text-md-decline" : "text-md-on-surface-variant",
            )}
          >
            Decline
          </button>

          <button
            type="button"
            data-testid={CALL_TEST_IDS.answer}
            aria-label="Answer"
            onClick={tapGuard(onAnswer)}
            className={clsx(
              "h-full flex-1 touch-none pr-7 text-right text-[14px] leading-5 font-medium tracking-[0.1px] transition-colors duration-300 ease-md-emphasized",
              answerLit ? "text-md-answer" : "text-md-on-surface-variant",
            )}
          >
            Answer
          </button>

          {/* The handle is deliberately not a button and deliberately not
            click-through: tapping the icon in the real app does nothing, and
            letting a tap fall through to whichever half happens to sit under
            the user's thumb would turn a hesitant poke into a decline. */}
          <div
            aria-hidden="true"
            className={clsx(
              "absolute top-1/2 left-1/2 -mt-7 -ml-7 flex h-14 w-14 touch-none items-center justify-center rounded-full bg-md-on-surface text-md-surface",
              !dragging &&
                "transition-transform duration-[350ms] ease-md-emphasized",
            )}
            style={{ transform: `translateX(${offset}px)` }}
          >
            <CallIcon
              className="h-7 w-7"
              // The handset wiggles while it waits, and holds still while you drag it.
              style={
                dragging
                  ? undefined
                  : { animation: "fp-android-ring 1.9s ease-in-out infinite" }
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
