"use client";

import clsx from "clsx";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  CaptionsIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  GearIcon,
  PauseIcon,
  PlayIcon,
  TheaterIcon,
  VolumeIcon,
  VolumeMutedIcon,
  type IconProps,
} from "@/components/icons";
import { formatDuration } from "@/domain/format";
import type { QualityOption } from "@/media/player";

import type { CaptionSettings } from "./captions";
import { ProgressBar, PROGRESS_BAR_HEIGHT } from "./progress-bar";
import { SettingsMenu } from "./settings-menu";

/**
 * The control bar, on the current "delhi-modern" chrome.
 *
 * **This is not the player most people remember, and the difference is
 * structural rather than cosmetic.** `research/08-youtube-ui-measured.md` §5.4:
 * `.ytp-gradient-bottom` computes `display: none` in this build
 * (`ytp-disable-bottom-gradient`). There is no dark scrim ramping up from the
 * bottom of the video. Instead every control sits on its own
 * `rgba(0,0,0,0.3)` pill (§1.3, §5.1) — the play button is a 40px circle, the
 * five right-hand controls share one 248×40 pill at radius 28 — and the video
 * is otherwise unobscured. A replica that paints the gradient is reproducing a
 * build that shipped some time ago.
 *
 * ## Geometry (§5.1, measured on a 1344×756 player)
 *
 * | Part | Value |
 * | --- | --- |
 * | Bar height | 56px, `padding: 3px 0 0`, inset 12px from each player edge |
 * | Play / mute | 40×40, `border-radius: 50%`, `rgba(0,0,0,0.3)`, 12px apart |
 * | Time | 115.3×56, `padding: 8px`, 14px/40px/500, `rgb(238,238,238)` |
 * | Right cluster | one pill, `radius 28`, `padding 0 4px`, buttons 48×40 |
 * | Icon shadow | `drop-shadow(rgba(0,0,0,0.8) 0 0 1px)` on the right cluster |
 * | Hover / active | `rgba(255,255,255,0.1)` / `rgba(255,255,255,0.2)` |
 *
 * The CSS defaults behind the measurement are a *larger* player —
 * `--yt-delhi-bottom-controls-height: 72px`, `--yt-delhi-pill-height: 48px`,
 * `padding 0 16px`, `backdrop-filter: blur(16px)`. The measured compact values
 * are what is built here, and the blur is the one measured-default property
 * kept, because a pill at 30% black over bright video is unreadable without it.
 *
 * ## Motion
 *
 * The player is the exception to this application's "chrome does not animate"
 * rule (`globals.css`, R8 §6): pill hover is 0.2s on `cubic-bezier(0.05,0,0,1)`
 * and the bar's auto-hide fade is 0.25s on the Material decelerate curve.
 */

/** §5.1: `.ytp-chrome-bottom` is 56px tall with 3px of padding above it. */
export const CONTROL_BAR_HEIGHT = 56;

/** §5.1: 12px inset from each player edge (`left: 12px`, `width: 1320px` of 1344). */
export const CONTROL_BAR_INSET = 12;

/**
 * How long the pointer must be still before the bar hides.
 *
 * **Assumed — and R8 says so explicitly.** §6: "The control bar auto-hide
 * **delay** is JS-driven (the player adds/removes `ytp-autohide`), not a CSS
 * `transition-delay`; only the 0.25s fade is expressed in CSS." So the fade is
 * measured (see `--yt-duration-autohide`) and the delay is not, because it was
 * never in a computed style to read. Three seconds is YouTube's familiar
 * behaviour and is a choice made here.
 */
export const CONTROLS_AUTOHIDE_MS = 3000;

/**
 * The volume slider's width when expanded.
 *
 * **Assumed.** The measured player carries `ytp-delhi-horizontal-volume-controls`
 * — so the slider is horizontal and beside the mute button rather than a
 * vertical popup — but it was captured collapsed, at 0 width, in every state in
 * `research/extracted/player-1920.json`.
 */
const VOLUME_SLIDER_WIDTH = 52;

export interface ControlsQualityProps {
  readonly qualities: readonly QualityOption[];
  readonly activeQualityId: string | null;
  readonly pinnedQualityId: string | null;
  readonly autoAvailable: boolean;
  readonly onSelectQuality: (id: string | "auto") => void;
}

export interface ControlsCaptionProps {
  readonly captionsAvailable: boolean;
  readonly captionsOn: boolean;
  readonly captionsLabel: string;
  readonly onToggleCaptions: (on: boolean) => void;
  readonly captionSettings: CaptionSettings;
  readonly onCaptionSettingsChange: (next: CaptionSettings) => void;
}

export interface PlayerControlsProps
  extends ControlsQualityProps,
    ControlsCaptionProps {
  readonly playing: boolean;
  readonly onTogglePlay: () => void;

  readonly onNext: (() => void) | undefined;

  readonly volume: number;
  readonly muted: boolean;
  readonly onVolumeChange: (volume: number) => void;
  readonly onToggleMute: () => void;

  readonly currentTime: number;
  readonly duration: number;
  readonly bufferedSeconds: number;
  readonly onSeek: (seconds: number) => void;

  readonly playbackRate: number;
  readonly onSelectPlaybackRate: (rate: number) => void;

  readonly theatre: boolean;
  readonly onToggleTheatre: () => void;
  readonly fullscreen: boolean;
  readonly onToggleFullscreen: () => void;
  readonly miniplayer: boolean;
  readonly onToggleMiniplayer: () => void;

  /** Driven by the auto-hide timer in `player.tsx`. */
  readonly visible: boolean;
  /** Raised whenever a control is used, so the caller can restart its timer. */
  readonly onActivity?: () => void;
  /** Raised on open/close so the caller can suppress auto-hide while a menu is up. */
  readonly onSettingsOpenChange?: (open: boolean) => void;
}

export function PlayerControls(props: PlayerControlsProps) {
  const {
    playing,
    onTogglePlay,
    onNext,
    volume,
    muted,
    onVolumeChange,
    onToggleMute,
    currentTime,
    duration,
    bufferedSeconds,
    onSeek,
    playbackRate,
    onSelectPlaybackRate,
    theatre,
    onToggleTheatre,
    fullscreen,
    onToggleFullscreen,
    miniplayer,
    onToggleMiniplayer,
    visible,
    onActivity,
    onSettingsOpenChange,
    captionsAvailable,
    captionsOn,
    captionsLabel,
    onToggleCaptions,
    captionSettings,
    onCaptionSettingsChange,
    qualities,
    activeQualityId,
    pinnedQualityId,
    autoAvailable,
    onSelectQuality,
  } = props;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  const setOpen = useCallback(
    (open: boolean) => {
      setSettingsOpen(open);
      onSettingsOpenChange?.(open);
      // §7.4: `Escape` closes the menu and returns focus to the trigger. The
      // trigger belongs to this component, so the restore does too.
      if (!open) settingsButtonRef.current?.focus();
    },
    [onSettingsOpenChange],
  );

  // There is deliberately no "close the menu when the bar hides" effect: the
  // bar cannot hide while a menu is open, because `player.tsx` holds it visible
  // for exactly that case (`onSettingsOpenChange` → its auto-hide guard). An
  // effect here would be dead code that reads as a safety net.

  return (
    <div
      data-player-chrome=""
      className="absolute bottom-0 flex flex-col"
      style={{
        left: `${CONTROL_BAR_INSET}px`,
        right: `${CONTROL_BAR_INSET}px`,
        // §5.1: `z-index: 59`, measured.
        zIndex: 59,
        paddingTop: "3px",
        opacity: visible ? 1 : 0,
        // Hidden controls must leave the tab order as well as the screen —
        // otherwise `Tab` lands on an invisible button, which is WCAG 2.4.11
        // (Focus Not Obscured) failing in its most literal form. `visibility`
        // is stepped at the end of the fade so it does not truncate it.
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        transition: `opacity var(--yt-duration-autohide) var(--yt-ease-fade), visibility 0s linear ${visible ? "0s" : "var(--yt-duration-autohide)"}`,
      }}
      onPointerMove={onActivity}
    >
      <div style={{ height: `${PROGRESS_BAR_HEIGHT}px` }}>
        <ProgressBar
          currentTime={currentTime}
          duration={duration}
          bufferedSeconds={bufferedSeconds}
          onSeek={onSeek}
        />
      </div>

      <div
        data-player-controls=""
        // §7.1: a toolbar groups related single-purpose controls under one
        // arrow-key strip. `role="group"` is used rather than `role="toolbar"`
        // deliberately: a toolbar's contract is roving tabindex across the whole
        // bar, and §6 has already spent the arrow keys on seek and volume. A
        // toolbar whose arrow keys do something else is worse than a group.
        role="group"
        aria-label="Player controls"
        className="flex items-center justify-between"
        style={{ height: `${CONTROL_BAR_HEIGHT}px` }}
      >
        <div className="flex items-center gap-3">
          <PillButton
            circle
            // §8.3, verbatim: the measured `aria-label` is
            // `Pause keyboard shortcut k`. §7.3: the name states the action the
            // press will perform, so it flips with state.
            label={playing ? "Pause keyboard shortcut k" : "Play keyboard shortcut k"}
            pressed={playing}
            onClick={() => {
              onActivity?.();
              onTogglePlay();
            }}
          >
            {/* §5.1: play/pause is the only 36-grid glyph, rendered 36×36. */}
            {playing ? <PauseIcon size={36} /> : <PlayIcon size={36} />}
          </PillButton>

          {onNext !== undefined ? (
            <PillButton
              circle
              label="Next (SHIFT+n)"
              onClick={() => {
                onActivity?.();
                onNext();
              }}
            >
              <NextIcon />
            </PillButton>
          ) : null}

          <VolumeControl
            volume={volume}
            muted={muted}
            onVolumeChange={(next) => {
              onActivity?.();
              onVolumeChange(next);
            }}
            onToggleMute={() => {
              onActivity?.();
              onToggleMute();
            }}
          />

          <TimeDisplay currentTime={currentTime} duration={duration} />
        </div>

        {/* §5.1: the right cluster is one pill — 248×40 for five buttons at
            48×40 plus 4px of padding each side. */}
        <div
          data-player-right-cluster=""
          className="flex items-center"
          style={{
            height: "40px",
            borderRadius: "28px",
            padding: "0 4px",
            background: "var(--yt-player-pill)",
            backdropFilter: "blur(16px)",
            // §5.1: measured only on the right cluster's icons.
            filter: "drop-shadow(rgba(0,0,0,0.8) 0 0 1px)",
          }}
        >
          <ClusterButton
            label={
              captionsAvailable
                ? captionsOn
                  ? "Turn off subtitles/closed captions (c)"
                  : "Subtitles/closed captions (c)"
                : // §8.3, verbatim, for the case the capture happened to be in.
                  "Subtitles/closed captions unavailable"
            }
            pressed={captionsAvailable ? captionsOn : undefined}
            disabled={!captionsAvailable}
            onClick={() => {
              onActivity?.();
              onToggleCaptions(!captionsOn);
            }}
          >
            <CaptionsIcon />
          </ClusterButton>

          <div className="relative">
            <ClusterButton
              ref={settingsButtonRef}
              label="Settings"
              // §7.4: the trigger is a menu button.
              haspopup="menu"
              expanded={settingsOpen}
              controls={settingsOpen ? menuId : undefined}
              onClick={() => {
                onActivity?.();
                setOpen(!settingsOpen);
              }}
            >
              <GearIcon />
            </ClusterButton>

            {settingsOpen ? (
              <div
                // §5.6: the panel sits above the bar. It is right-aligned to
                // its trigger rather than to the pill, which is what keeps it
                // in place when the cluster gains or loses a button.
                className="absolute right-0 bottom-full mb-3"
                onPointerMove={onActivity}
              >
                <SettingsMenu
                  id={menuId}
                  qualities={qualities}
                  activeQualityId={activeQualityId}
                  pinnedQualityId={pinnedQualityId}
                  autoAvailable={autoAvailable}
                  onSelectQuality={onSelectQuality}
                  playbackRate={playbackRate}
                  onSelectPlaybackRate={onSelectPlaybackRate}
                  captionsAvailable={captionsAvailable}
                  captionsOn={captionsOn}
                  captionsLabel={captionsLabel}
                  onToggleCaptions={onToggleCaptions}
                  captionSettings={captionSettings}
                  onCaptionSettingsChange={onCaptionSettingsChange}
                  onClose={() => setOpen(false)}
                />
              </div>
            ) : null}
          </div>

          <ClusterButton
            label="Miniplayer (i)"
            pressed={miniplayer}
            onClick={() => {
              onActivity?.();
              onToggleMiniplayer();
            }}
          >
            <MiniplayerIcon />
          </ClusterButton>

          <ClusterButton
            label="Theater mode (t)"
            pressed={theatre}
            onClick={() => {
              onActivity?.();
              onToggleTheatre();
            }}
          >
            <TheaterGlyph active={theatre} />
          </ClusterButton>

          <ClusterButton
            label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"}
            pressed={fullscreen}
            onClick={() => {
              onActivity?.();
              onToggleFullscreen();
            }}
          >
            {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </ClusterButton>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- time --- */

/**
 * §5.5: `M:SS / M:SS`, with the separator as **its own element whose text is
 * `" / "`, spaces included**.
 *
 * That detail is measured (`.ytp-time-separator`) and is worth reproducing
 * rather than writing `{current} / {duration}`: it is what lets the separator
 * be styled or hidden independently, and it is how the string is composed in
 * the product.
 */
function TimeDisplay({
  currentTime,
  duration,
}: {
  readonly currentTime: number;
  readonly duration: number;
}) {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return (
    <div
      data-player-time=""
      className="flex items-center rounded-full"
      style={{
        height: "40px",
        padding: "0 12px",
        background: "var(--yt-player-pill)",
        backdropFilter: "blur(16px)",
        color: "var(--yt-player-ink)",
        // §2.2: 14px / 40px / 500.
        fontSize: "14px",
        lineHeight: "40px",
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span data-time-current="">{formatDuration(currentTime)}</span>
      <span data-time-separator="">{" / "}</span>
      <span data-time-duration="">{formatDuration(total)}</span>
    </div>
  );
}

/* -------------------------------------------------------------- volume --- */

function VolumeControl({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: {
  readonly volume: number;
  readonly muted: boolean;
  readonly onVolumeChange: (volume: number) => void;
  readonly onToggleMute: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const level = muted ? 0 : volume;

  const fractionAt = useCallback((clientX: number): number | null => {
    const track = trackRef.current;
    if (track === null) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  }, []);

  const apply = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const fraction = fractionAt(event.clientX);
      if (fraction !== null) onVolumeChange(fraction);
    },
    [fractionAt, onVolumeChange],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // The same 5% step the `↑`/`↓` shortcuts use (research/07 §6), so the two
      // ways of changing the volume land on the same values.
      const step = (delta: number): void => {
        event.preventDefault();
        event.stopPropagation();
        onVolumeChange(Math.min(Math.max(level + delta, 0), 1));
      };
      switch (event.key) {
        case "ArrowRight":
        case "ArrowUp":
          return step(0.05);
        case "ArrowLeft":
        case "ArrowDown":
          return step(-0.05);
        case "Home":
          return step(-1);
        case "End":
          return step(1);
        default:
          return;
      }
    },
    [level, onVolumeChange],
  );

  return (
    <div
      data-player-volume=""
      className="flex items-center rounded-full"
      style={{
        height: "40px",
        background: "var(--yt-player-pill)",
        backdropFilter: "blur(16px)",
        transition: "width var(--yt-duration-pill-hover) var(--yt-ease-move)",
      }}
      onPointerEnter={() => setExpanded(true)}
      onPointerLeave={() => {
        if (!dragging) setExpanded(false);
      }}
      onFocus={() => setExpanded(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
    >
      <button
        type="button"
        data-player-mute=""
        // §8.3, verbatim.
        aria-label={muted || volume === 0 ? "Unmute (m)" : "Mute (m)"}
        // §7.3: mute is the same toggle-button shape as play/pause.
        aria-pressed={muted}
        className="grid size-10 shrink-0 place-items-center rounded-full"
        style={{ color: "var(--yt-player-ink)" }}
        onClick={onToggleMute}
      >
        {muted || volume === 0 ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>

      <div
        data-player-volume-slider=""
        role="slider"
        tabIndex={expanded ? 0 : -1}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        aria-valuetext={`${Math.round(level * 100)}%`}
        aria-hidden={expanded ? undefined : true}
        className="flex h-10 cursor-pointer touch-none items-center overflow-hidden"
        style={{
          width: expanded ? `${VOLUME_SLIDER_WIDTH}px` : "0px",
          marginRight: expanded ? "12px" : "0px",
          transition:
            "width var(--yt-duration-pill-hover) var(--yt-ease-move), margin-right var(--yt-duration-pill-hover) var(--yt-ease-move)",
        }}
        onPointerDown={(event) => {
          setDragging(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
          apply(event);
        }}
        onPointerMove={(event) => {
          if (dragging) apply(event);
        }}
        onPointerUp={(event) => {
          setDragging(false);
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onKeyDown={onKeyDown}
      >
        <div
          ref={trackRef}
          className="relative h-[3px] w-full rounded-full"
          style={{ background: "rgba(255, 255, 255, 0.3)" }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${level * 100}%`, background: "var(--yt-player-ink)" }}
          />
          <div
            className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full"
            style={{
              left: `${level * 100}%`,
              marginLeft: "-6px",
              background: "var(--yt-player-ink)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- buttons -- */

interface PillButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly circle?: boolean;
  readonly pressed?: boolean;
}

/**
 * A left-cluster control: its own 40×40 pill.
 *
 * §5.1's `border-radius: 50%` on the play button is what makes the left cluster
 * read as separate coins rather than as a bar — it is the most visible single
 * difference between this chrome and the gradient one.
 */
function PillButton({ label, onClick, children, circle, pressed }: PillButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      className={clsx(
        "grid size-10 shrink-0 place-items-center",
        circle === true ? "rounded-full" : "rounded-prominent",
      )}
      style={{
        background: "var(--yt-player-pill)",
        backdropFilter: "blur(16px)",
        color: "var(--yt-player-ink)",
        // §6: 0.1s on the accelerate curve is the measured play-button fade.
        transition: "opacity var(--yt-duration-menu-open) var(--yt-ease-accelerate)",
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface ClusterButtonProps extends PillButtonProps {
  readonly disabled?: boolean;
  readonly haspopup?: "menu";
  readonly expanded?: boolean;
  readonly controls?: string | undefined;
  readonly ref?: React.Ref<HTMLButtonElement>;
}

/**
 * A right-cluster control: 48×40 inside the shared pill.
 *
 * §5.1 measures the hover as a `::before` pad 48px wide at radius 40 filled
 * `rgba(255,255,255,0.1)`, transitioning over 0.2s on `cubic-bezier(.05,0,0,1)`
 * — not a background on the button itself. The pad is the same width as the
 * button here, so the rounded background below is the same pixels with one
 * fewer element.
 */
function ClusterButton({
  label,
  onClick,
  children,
  disabled,
  pressed,
  haspopup,
  expanded,
  controls,
  ref,
}: ClusterButtonProps) {
  const style: CSSProperties = {
    width: "48px",
    height: "40px",
    borderRadius: "40px",
    color: "var(--yt-player-ink)",
    transition: "background-color var(--yt-duration-pill-hover) var(--yt-ease-move)",
  };
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled === true}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...(haspopup === undefined ? {} : { "aria-haspopup": haspopup })}
      {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
      {...(controls === undefined ? {} : { "aria-controls": controls })}
      className={clsx(
        "grid shrink-0 place-items-center",
        disabled === true
          ? "cursor-default opacity-50"
          : "hover:bg-[var(--yt-player-pill-hover)] active:bg-[var(--yt-player-pill-active)]",
      )}
      style={style}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- glyphs -- */

/**
 * Two glyphs the shared icon set does not carry.
 *
 * `src/components/icons.tsx` is fixed for this slice, and both of these were
 * captured at **0×0** — `ytp-next-button` is playlist-only and `ytp-pip-button`
 * was not rendered for the sampled video (`player-1920.json` `rest.buttons`) —
 * so there is no measured path for either. They are drawn here on the 24 grid
 * with the fill-only, no-stroke construction §7 records for every other icon.
 *
 * The miniplayer button's *position* in the cluster is likewise **assumed**:
 * the measured DOM order is `autoplay · subtitles · settings · theater · remote
 * · fullscreen · pip`, but `pip` at 0×0 tells us nothing about where it renders
 * when it is visible.
 */
function NextIcon(props: IconProps) {
  const { size = 24, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M5 5.2a1 1 0 0 1 1.53-.85l9.3 5.95a1.2 1.2 0 0 1 0 2.02l-9.3 5.95A1 1 0 0 1 5 17.42V5.2Z" />
      <rect x="17" y="5" width="2.4" height="14" rx="1.2" />
    </svg>
  );
}

function MiniplayerIcon(props: IconProps) {
  const { size = 24, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        fillRule="evenodd"
        d="M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v12h18V6H3Z"
      />
      <rect x="12" y="11" width="8" height="6" rx="1" />
    </svg>
  );
}

/**
 * Theatre mode, in both states.
 *
 * The shared `TheaterIcon` is the "go wide" frame. Its inverse — the glyph
 * shown *while* in theatre, which offers the way back — is a narrower frame,
 * and drawing it here keeps the pair together rather than shipping one state.
 */
function TheaterGlyph({ active }: { readonly active: boolean }) {
  // Inactive is the shared set's measured wide frame. Active is its inverse — a
  // narrower frame, offering the way back — which the icon set does not carry
  // because the capture was taken with theatre off.
  if (!active) return <TheaterIcon />;
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm1 2v6h14V9H5Z"
      />
    </svg>
  );
}
