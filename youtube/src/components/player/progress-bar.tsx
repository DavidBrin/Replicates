"use client";

import clsx from "clsx";
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { describeDuration, formatDuration } from "@/domain/format";
import { SEEK_JUMP_SECONDS, SEEK_STEP_SECONDS } from "./keyboard";

/**
 * The scrubber.
 *
 * Every number here is from `research/08-youtube-ui-measured.md` §5.2 and §1.3,
 * and the ARIA shape is §7.2 of `research/07-captions-and-a11y.md`.
 *
 * ## Three things that are easy to get wrong and are load-bearing
 *
 * **1. All three segments are `transform: scaleX()` on full-width elements**,
 * not width animations (§5.2). R8 calls this out as "worth copying, it is why
 * the bar never reflows" — a bar built from `width: 43%` re-lays-out four times
 * a second for the whole video, and on a long page that is the single most
 * expensive thing the player does.
 *
 * **2. The played segment is a gradient sized to the whole bar** (§1.3):
 * `linear-gradient(90deg, rgb(255,0,51) 80%, rgb(255,39,145))`, so the pink end
 * is only reached as playback approaches the right edge. At 10% you see only
 * `#ff0033`. This is the finding that overrides everyone's memory of a flat red
 * bar, and see {@link playedStyle} for the one place the measurement and its
 * described effect have to be reconciled.
 *
 * **3. The track is `scaleY(0.667)` at rest and `none` on hover** — 4px of
 * visible track growing to 6px, over 0.2s on `cubic-bezier(0.05, 0, 0, 1)`
 * (§5.2, §6). The container is 6px in both states, so the growth costs no
 * layout either.
 *
 * ## The hover-ahead segment
 *
 * `rgba(255,255,255,0.5)` (§1.3), drawn from the playhead to the pointer. It is
 * the thing that makes a scrub feel like it has already happened, and it is a
 * third scaled element rather than a fourth colour on the buffered one.
 */

/** §5.2: the container is 6px tall in both states. */
export const PROGRESS_BAR_HEIGHT = 6;

/** §5.2: `scaleY(0.667)` at rest → 4px of visible track. */
const REST_SCALE_Y = 0.667;

/** §5.2: 12×12 at rest, `scale(1.67)` on hover → 20.04px effective. */
const SCRUBBER_SIZE = 12;
const SCRUBBER_HOVER_SCALE = 1.67;

export interface ProgressBarProps {
  readonly currentTime: number;
  readonly duration: number;
  /** The end of the buffered range covering the playhead, in seconds. */
  readonly bufferedSeconds: number;
  readonly onSeek: (seconds: number) => void;
  /**
   * Called as a drag moves, before it is committed.
   *
   * Separate from `onSeek` so the caller can paint the frame under the pointer
   * without issuing a network seek per pixel. This player passes both to the
   * same handler — the engine re-derives its fetch decision from the playhead
   * every tick (`nextSegmentIndex`, research/03 §5) so a mid-drag seek is
   * cheap — but the seam is here for a caller that cannot afford it.
   */
  readonly onScrub?: (seconds: number) => void;
  readonly className?: string;
}

export function ProgressBar({
  currentTime,
  duration,
  bufferedSeconds,
  onSeek,
  onScrub,
  className,
}: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const total = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const played = total > 0 ? clamp01(currentTime / total) : 0;
  const buffered = total > 0 ? clamp01(bufferedSeconds / total) : 0;

  /**
   * Pointer x → a fraction of the bar.
   *
   * Reads the bar's box on every call rather than caching it on pointerdown:
   * the theatre and fullscreen keys both resize the player mid-drag, and a
   * cached rect turns that into a seek to the wrong second.
   */
  const fractionAt = useCallback((clientX: number): number | null => {
    const bar = barRef.current;
    if (bar === null) return null;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return clamp01((clientX - rect.left) / rect.width);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Left button only: a right-click on the bar opens the context menu, and
      // a middle-click should not seek.
      if (event.button !== 0) return;
      const fraction = fractionAt(event.clientX);
      if (fraction === null) return;
      setScrubbing(true);
      setHoverFraction(fraction);
      // Capture, so a drag that leaves the 6px bar — which is every drag —
      // keeps delivering moves here instead of to whatever is underneath.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      (onScrub ?? onSeek)(fraction * total);
    },
    [fractionAt, onScrub, onSeek, total],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const fraction = fractionAt(event.clientX);
      if (fraction === null) return;
      setHoverFraction(fraction);
      if (scrubbing) (onScrub ?? onSeek)(fraction * total);
    },
    [fractionAt, onScrub, onSeek, scrubbing, total],
  );

  const endScrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!scrubbing) return;
      setScrubbing(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      const fraction = fractionAt(event.clientX) ?? hoverFraction;
      if (fraction !== null) onSeek(fraction * total);
    },
    [fractionAt, hoverFraction, onSeek, scrubbing, total],
  );

  /**
   * §7.2's keyboard interaction, with one deliberate deviation.
   *
   * The APG slider pattern binds `↑`/`↓` to the same step as `→`/`←`. §7.2
   * notes that APG's slider semantics and YouTube's player semantics "already
   * agree" on `←`/`→` and `Home`/`End` — but they do **not** agree on the
   * vertical pair, which §6 gives to volume. The vertical keys are therefore
   * left unhandled here so they reach the document-level shortcut layer and
   * change the volume, which is what a viewer pressing `↑` on a video player
   * expects. `PageUp`/`PageDown` take the pattern's optional larger increment
   * and are bound to §6's own ±10s jump rather than a third number.
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = (seconds: number): void => {
        event.preventDefault();
        // The document handler skips defaultPrevented events, so this is also
        // what stops `←` seeking twice.
        event.stopPropagation();
        onSeek(clamp(currentTime + seconds, 0, total));
      };
      switch (event.key) {
        case "ArrowRight":
          return step(SEEK_STEP_SECONDS);
        case "ArrowLeft":
          return step(-SEEK_STEP_SECONDS);
        case "PageUp":
          return step(SEEK_JUMP_SECONDS);
        case "PageDown":
          return step(-SEEK_JUMP_SECONDS);
        case "Home":
          event.preventDefault();
          event.stopPropagation();
          return onSeek(0);
        case "End":
          event.preventDefault();
          event.stopPropagation();
          return onSeek(total);
        default:
          return;
      }
    },
    [currentTime, onSeek, total],
  );

  const expanded = scrubbing || hoverFraction !== null;
  const hoverAhead =
    hoverFraction === null ? 0 : Math.max(hoverFraction - played, 0);

  return (
    <div
      ref={barRef}
      data-progress-bar=""
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      // §7.2: always set these explicitly. Omitted, a slider defaults to 0–100,
      // which for a 30-minute video reports the wrong number to every AT user.
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(clamp(currentTime, 0, total))}
      // §7.2: `aria-valuenow="128"` reads as "one hundred and twenty-eight".
      // `describeDuration` is the same helper the thumbnail badge's accessible
      // name uses, so both surfaces say "2 minutes 8 seconds" the same way.
      aria-valuetext={`${describeDuration(currentTime)} of ${describeDuration(total)}`}
      className={clsx(
        "group/progress relative flex cursor-pointer touch-none items-center",
        className,
      )}
      style={{ height: `${PROGRESS_BAR_HEIGHT}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onPointerLeave={() => {
        if (!scrubbing) setHoverFraction(null);
      }}
      onKeyDown={onKeyDown}
    >
      {/* The track. §5.2: 6px box, scaled to 0.667 at rest. */}
      <div
        data-progress-track=""
        className="relative w-full overflow-hidden"
        style={{
          height: `${PROGRESS_BAR_HEIGHT}px`,
          background: "var(--yt-player-track)",
          transform: expanded ? "none" : `scaleY(${REST_SCALE_Y})`,
          transition:
            "transform var(--yt-duration-progress-grow) var(--yt-ease-move)",
        }}
      >
        <Segment
          name="buffered"
          fraction={buffered}
          style={{ background: "var(--yt-player-buffered)" }}
        />
        <Segment
          name="hover-ahead"
          fraction={hoverAhead}
          style={{
            background: "var(--yt-player-hover-ahead)",
            left: `${played * 100}%`,
          }}
        />
        <Segment name="played" fraction={played} style={playedStyle(played)} />
      </div>

      {/* §5.2: 12×12 handle, `rgb(255,0,51)`, growing 1.67× on hover. */}
      <div
        data-progress-scrubber=""
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 rounded-full"
        style={{
          width: `${SCRUBBER_SIZE}px`,
          height: `${SCRUBBER_SIZE}px`,
          background: "var(--yt-player-scrubber)",
          left: `${played * 100}%`,
          marginLeft: `${-SCRUBBER_SIZE / 2}px`,
          transform: `translateY(-50%) scale(${expanded ? SCRUBBER_HOVER_SCALE : 1})`,
          transition:
            "transform var(--yt-duration-scrubber-grow) var(--yt-ease-accelerate)",
        }}
      />

      {hoverFraction !== null && total > 0 ? (
        <ScrubTooltip fraction={hoverFraction} seconds={hoverFraction * total} />
      ) : null}
    </div>
  );
}

/**
 * One scaled segment.
 *
 * `transform-origin: 0 0` is measured (`player-1920.json`
 * `rest.progressRest.play.transformOrigin`) and is what makes `scaleX` grow
 * rightwards from the start of the bar rather than outwards from its middle.
 */
function Segment({
  name,
  fraction,
  style,
}: {
  readonly name: string;
  readonly fraction: number;
  readonly style: CSSProperties;
}) {
  return (
    <div
      data-progress-segment={name}
      aria-hidden="true"
      className="absolute inset-y-0 left-0 w-full"
      style={{
        transformOrigin: "0 0",
        transform: `scaleX(${clamp01(fraction)})`,
        ...style,
      }}
    />
  );
}

/**
 * The played segment's fill — and the one place a measurement and its stated
 * effect had to be reconciled.
 *
 * §1.3 measured `background-size: <bar width>px` on an element that also
 * carries `transform: scaleX(fraction)`, and described the result as "at 10%
 * progress you see only the `#ff0033` end; the pink only appears as playback
 * approaches the right edge". Those two statements do not both hold: a
 * transform scales the painted background along with the box, so a bar-width
 * background on a scaled element compresses the whole ramp into the played
 * region and shows pink at the playhead from the first second.
 *
 * The described **appearance** is what this reproduces, because that is the
 * thing a side-by-side screenshot compares. The background is counter-scaled —
 * `background-size: (100 / fraction)%` — so after `scaleX(fraction)` the ramp
 * lands across exactly the full bar width and the 80% stop sits at 80% *of the
 * bar*, not of the played part. The measured declaration is recorded above and
 * the deviation is here rather than silent.
 */
function playedStyle(fraction: number): CSSProperties {
  // Below this the counter-scale explodes and the segment is sub-pixel anyway.
  const safe = Math.max(fraction, 0.001);
  return {
    backgroundImage: "var(--yt-player-played)",
    backgroundSize: `${100 / safe}% 100%`,
    backgroundPositionX: "0",
    backgroundRepeat: "no-repeat",
  };
}

/**
 * The scrub tooltip.
 *
 * §5.3 measured a 242.36×138 white-framed box carrying a **storyboard sprite
 * frame** plus the timestamp and the hint line. The frame is not rendered here:
 * a storyboard sprite is a per-video artefact (`i.ytimg.com/sb/<id>/…`) and
 * nothing in this application generates one — `videos.preview_key` is the
 * hover-preview clip, which is a different asset with no per-second addressing.
 * What is kept is the text and its measured type (12.98px/15px, 500,
 * `rgb(238,238,238)`) and the hint copy verbatim from §8.3.
 *
 * Rendering the frame at its measured size with nothing in it would be a white
 * rectangle over the video, which is worse than a smaller tooltip.
 */
function ScrubTooltip({
  fraction,
  seconds,
}: {
  readonly fraction: number;
  readonly seconds: number;
}) {
  return (
    <div
      data-scrub-tooltip=""
      aria-hidden="true"
      className="pointer-events-none absolute bottom-full mb-3 -translate-x-1/2 rounded-compact px-2 py-1 text-center whitespace-nowrap"
      style={{
        left: `${fraction * 100}%`,
        background: "var(--yt-player-panel)",
        color: "var(--yt-player-ink)",
        fontSize: "12.98px",
        lineHeight: "15px",
        fontWeight: 500,
      }}
    >
      <div data-scrub-hint="">Pull up for precise seeking</div>
      <div data-scrub-time="">{formatDuration(seconds)}</div>
    </div>
  );
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
