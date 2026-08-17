"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createPlayer,
  type CreatePlayerOptions,
  type EngineState,
  type PlayerEngine,
  type ProgressiveSource,
} from "@/media/player";
import type { Pipeline } from "@/domain/types";

import {
  CaptionLayer,
  DEFAULT_CAPTION_SETTINGS,
  CAPTION_FONT_SCALES,
  cycledOpacity,
  steppedScale,
  useActiveCues,
  type CaptionSettings,
  type TextTrackLike,
} from "./captions";
import {
  CONTROLS_AUTOHIDE_MS,
  CONTROL_BAR_HEIGHT,
  PlayerControls,
} from "./controls";
import {
  isTypingContext,
  resolveShortcut,
  steppedPlaybackRate,
  type PlayerAction,
} from "./keyboard";

/**
 * The player: a `<video>`, an engine driving its buffer, and our chrome on top.
 *
 * ## The division of labour, which is the thing to understand first
 *
 * `src/media/player/` owns **what bytes reach the element**: the master
 * playlist, the ABR selector, the `SourceBuffer` lifecycle, the quality pin.
 * It is finished and it is not modified here. Its own documentation states the
 * boundary — *"the engine never calls `play()`/`pause()`/seeks"* — so
 * **everything the viewer does is this component's**: play, pause, seek,
 * volume, rate, fullscreen, captions.
 *
 * The two meet at exactly two points. This component reads `EngineState` for
 * the things only the engine knows (the ladder, which rung is *rendering*, how
 * much runway is buffered, the QoE metrics) and calls `setQuality` when the
 * viewer picks one. Nothing else crosses.
 *
 * ## Why `createEngine` is a prop
 *
 * `MediaSource` and WebCodecs do not exist in jsdom, so `createPlayer` on a
 * laddered video resolves to the progressive path in a test and throws if no
 * progressive source was supplied. Rather than special-case the environment,
 * the constructor is injectable — the same reasoning `DECISIONS.md` D4 gives
 * for typing the engine against `MediaElementLike` instead of the DOM class.
 * A test hands in a fake `PlayerEngine` and asserts what the chrome does with
 * a state; the browser gets the real one.
 *
 * ## Duration
 *
 * `durationSeconds` comes from the `videos` row and is used until the element
 * reports its own. That is not belt-and-braces: `video.duration` is `NaN`
 * until metadata arrives, and a scrubber whose `aria-valuemax` is `NaN` for
 * the first second is a scrubber that announces nothing.
 */

export interface PlayerCaptionTrack {
  readonly src: string;
  readonly srcLang: string;
  readonly label: string;
  readonly default?: boolean;
}

export interface PlayerProps {
  readonly videoId: string;
  readonly title: string;
  readonly pipeline: Pipeline;
  readonly durationSeconds: number;
  readonly masterPlaylistUrl?: string | undefined;
  readonly progressiveSources?: readonly ProgressiveSource[] | undefined;
  readonly renditionCodecs?: readonly string[] | undefined;
  readonly posterUrl?: string | null | undefined;
  readonly captionTracks?: readonly PlayerCaptionTrack[] | undefined;
  /** From `video_renditions.frame_rate`, for `,`/`.` frame stepping. */
  readonly frameRate?: number | undefined;

  /** Theatre is a property of the *page*, so the watch view owns the state. */
  readonly theatre: boolean;
  readonly onToggleTheatre: () => void;
  readonly onNext?: (() => void) | undefined;
  readonly onPrevious?: (() => void) | undefined;
  readonly onTimeUpdate?: ((seconds: number) => void) | undefined;

  /** Test seam. See the file comment. */
  readonly createEngine?: ((options: CreatePlayerOptions) => PlayerEngine) | undefined;
  readonly className?: string;
}

/**
 * How many rebuffers while pinned before the player offers a way out.
 *
 * `setQuality`'s contract in `src/media/player/engine.ts` is explicit that a
 * pinned rendition **rebuffers rather than dropping** — the buffer floor and the
 * abandonment rule are both suppressed while a pin is in force — and equally
 * explicit about what the UI owes in return: *"the UI can offer 'struggling to
 * play at 1080p — switch to Auto?' — a nudge, never an automatic revert."*
 * Two is chosen so a single stall on a seek does not trigger it; the number is
 * this file's, the behaviour is the engine's.
 */
const STRUGGLE_REBUFFER_COUNT = 2;

export function Player({
  videoId,
  title,
  pipeline,
  durationSeconds,
  masterPlaylistUrl,
  progressiveSources,
  renditionCodecs,
  posterUrl,
  captionTracks = [],
  frameRate,
  theatre,
  onToggleTheatre,
  onNext,
  onPrevious,
  onTimeUpdate,
  createEngine,
  className,
}: PlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [engineError, setEngineError] = useState<Error | null>(null);
  const engineRef = useRef<PlayerEngine | null>(null);

  const reportEngineFailure = useCallback((cause: unknown) => {
    setEngineError(cause instanceof Error ? cause : new Error(String(cause)));
  }, []);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [elementDuration, setElementDuration] = useState<number | null>(null);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);

  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(
    DEFAULT_CAPTION_SETTINGS,
  );
  const [track, setTrack] = useState<TextTrackLike | null>(null);

  const [fullscreen, setFullscreen] = useState(false);
  const [miniplayer, setMiniplayer] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [playerHeight, setPlayerHeight] = useState(0);

  const duration =
    elementDuration !== null && Number.isFinite(elementDuration) && elementDuration > 0
      ? elementDuration
      : durationSeconds;

  /* -------------------------------------------------------------- engine -- */

  useEffect(() => {
    const media = videoRef.current;
    if (media === null) return;

    const build = createEngine ?? createPlayer;
    let engine: PlayerEngine;
    try {
      engine = build({
        media,
        pipeline,
        masterPlaylistUrl,
        progressiveSources,
        renditionCodecs,
      });
    } catch (cause) {
      // `createPlayer` throws when a path is asked for that cannot be built —
      // a laddered video with no playlist, or a browser with no MSE and no
      // progressive fallback. Surfacing it is the whole point: the alternative
      // is a black rectangle with no explanation.
      reportEngineFailure(cause);
      return;
    }

    engineRef.current = engine;
    setEngineError(null);
    const unsubscribe = engine.subscribe(setEngineState);
    void engine.load();

    return () => {
      unsubscribe();
      engine.destroy();
      engineRef.current = null;
    };
    // `videoId` rather than the derived URLs: those are new array/string
    // identities on every render of the parent, and rebuilding the engine on a
    // parent re-render would restart the video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  /* ------------------------------------------------------- element state -- */

  useEffect(() => {
    const media = videoRef.current;
    if (media === null) return;

    const sync = (): void => {
      setPlaying(!media.paused && !media.ended);
      setVolumeState(media.volume);
      setMuted(media.muted);
      setPlaybackRateState(media.playbackRate);
    };
    const onTime = (): void => {
      setCurrentTime(media.currentTime);
      onTimeUpdate?.(media.currentTime);
    };
    const onDuration = (): void => {
      setElementDuration(Number.isFinite(media.duration) ? media.duration : null);
    };
    const onEnded = (): void => {
      setPlaying(false);
      setControlsVisible(true);
      setAnnouncement("Video ended");
    };

    const events: [string, () => void][] = [
      ["play", sync],
      ["pause", sync],
      ["volumechange", sync],
      ["ratechange", sync],
      ["timeupdate", onTime],
      ["seeked", onTime],
      ["durationchange", onDuration],
      ["loadedmetadata", onDuration],
      ["ended", onEnded],
    ];
    for (const [type, listener] of events) media.addEventListener(type, listener);
    sync();
    onDuration();

    return () => {
      for (const [type, listener] of events) media.removeEventListener(type, listener);
    };
  }, [onTimeUpdate]);

  // The caption base size is a fraction of the player's height (research/07 §2
  // is why we place cues ourselves; the *size* following the box is so one
  // setting reads the same inline and fullscreen).
  useEffect(() => {
    const node = containerRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setPlayerHeight(node.getBoundingClientRect().height);
    });
    observer.observe(node);
    setPlayerHeight(node.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, []);

  /* ------------------------------------------------------------ captions -- */

  useEffect(() => {
    const media = videoRef.current;
    if (media === null) return;
    const tracks = media.textTracks;
    // `textTracks[0]`, not the `<track>` element's `.track`: the list is
    // populated by the browser once the element is parsed, and reading it here
    // is the only way to get the object the `cuechange` event fires on.
    const first = tracks.length > 0 ? tracks[0] : undefined;
    setTrack((first as TextTrackLike | undefined) ?? null);
  }, [captionTracks]);

  const cues = useActiveCues(track, captionsOn);
  const captionsAvailable = captionTracks.length > 0;
  const captionsLabel = captionTracks[0]?.label ?? "English";

  /* ------------------------------------------------------------ controls -- */

  const seekTo = useCallback(
    (seconds: number) => {
      const media = videoRef.current;
      if (media === null) return;
      const bounded = Math.min(Math.max(seconds, 0), duration || 0);
      media.currentTime = bounded;
      setCurrentTime(bounded);
    },
    [duration],
  );

  const togglePlay = useCallback(() => {
    const media = videoRef.current;
    if (media === null) return;
    if (media.paused) {
      // research/03 §10: always handle the rejection branch. An unmuted
      // autoplay is refused with `NotAllowedError` and leaving the UI showing a
      // pause glyph over a stopped video is worse than the refusal.
      void media.play().catch(() => setPlaying(false));
    } else {
      media.pause();
    }
  }, []);

  const setVolume = useCallback((next: number) => {
    const media = videoRef.current;
    if (media === null) return;
    const bounded = Math.min(Math.max(next, 0), 1);
    media.volume = bounded;
    // Raising the volume on a muted element is how a viewer says "unmute" —
    // leaving `muted` set means the slider moves and nothing is heard.
    if (bounded > 0 && media.muted) media.muted = false;
    setVolumeState(bounded);
  }, []);

  const toggleMute = useCallback(() => {
    const media = videoRef.current;
    if (media === null) return;
    media.muted = !media.muted;
    setMuted(media.muted);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const media = videoRef.current;
    if (media === null) return;
    media.playbackRate = rate;
    setPlaybackRateState(rate);
    setAnnouncement(`Playback speed: ${rate === 1 ? "Normal" : `${rate}×`}`);
  }, []);

  const toggleCaptions = useCallback(
    (on: boolean) => {
      if (!captionsAvailable) return;
      setCaptionsOn(on);
      // §7.5: a state change not colocated with a focusable control is exactly
      // what the live region is for.
      setAnnouncement(on ? "Captions on" : "Captions off");
    },
    [captionsAvailable],
  );

  const toggleFullscreen = useCallback(() => {
    const node = containerRef.current;
    if (node === null) return;
    if (document.fullscreenElement === null || document.fullscreenElement === undefined) {
      // Both calls are guarded: neither exists in jsdom, and `requestFullscreen`
      // rejects rather than throwing when the gesture is not user-initiated.
      void node.requestFullscreen?.().catch(() => undefined);
    } else {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onChange = (): void => {
      setFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleMiniplayer = useCallback(() => {
    const media = videoRef.current as
      | (HTMLVideoElement & {
          requestPictureInPicture?: () => Promise<unknown>;
        })
      | null;
    if (media === null) return;
    const doc = document as Document & {
      pictureInPictureElement?: Element | null;
      exitPictureInPicture?: () => Promise<void>;
    };
    // Picture-in-Picture *is* the miniplayer here. YouTube's own is an in-page
    // floating player rather than the browser's, but reimplementing that means
    // moving a playing `<video>` across the React tree — which remounts it and
    // restarts the download — for a surface no measurement in this research
    // pass covers. The browser's is the honest version of the same affordance.
    if (doc.pictureInPictureElement) {
      void doc.exitPictureInPicture?.().catch(() => undefined);
      setMiniplayer(false);
      return;
    }
    if (typeof media.requestPictureInPicture !== "function") {
      setAnnouncement("Miniplayer is not available in this browser");
      return;
    }
    void media
      .requestPictureInPicture()
      .then(() => setMiniplayer(true))
      .catch(() => setMiniplayer(false));
  }, []);

  const selectQuality = useCallback(
    (id: string | "auto") => {
      engineRef.current?.setQuality(id);
      setNudgeDismissed(false);
      setAnnouncement(id === "auto" ? "Quality: Auto" : "Quality pinned");
    },
    [],
  );

  /* ------------------------------------------------------------ autohide -- */

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealControls = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    setControlsVisible(true);
  }, []);

  const noteActivity = useCallback(() => {
    revealControls();
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_AUTOHIDE_MS);
  }, [revealControls]);

  useEffect(() => {
    // Four states hold the bar open, and the last two are accessibility rather
    // than taste: a paused player is being read rather than watched; an open
    // menu that faded out from under the pointer is a bug; and WCAG 2.4.11
    // (research/07 §8.2) requires that focusing a control forces the bar
    // visible rather than letting the timeout hide it out from under focus.
    if (!playing || menuOpen) {
      revealControls();
      return;
    }
    noteActivity();
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, [menuOpen, noteActivity, playing, revealControls]);

  /* ------------------------------------------------------------ keyboard -- */

  /**
   * The shortcut layer, installed once.
   *
   * The handler body is read through a ref rather than being a dependency, so
   * the document listener is attached on mount and never re-attached. A
   * listener rebuilt on every `timeupdate` — four times a second — would be
   * the most expensive thing on the page.
   */
  const run = useCallback(
    (action: PlayerAction) => {
      // Relative seeks read the *element*, not the React state. `timeupdate`
      // fires about four times a second, so the state can be up to 250ms stale
      // — and two quick presses of `l` would both compute from the same origin
      // and add up to one jump instead of two.
      const at = videoRef.current?.currentTime ?? currentTime;
      switch (action.kind) {
        case "toggle-play":
          return togglePlay();
        case "seek-by":
          return seekTo(at + action.seconds);
        case "seek-to-fraction":
          return seekTo(duration * action.fraction);
        case "frame-step":
          return seekTo(at + action.seconds);
        case "volume-by":
          return setVolume((muted ? 0 : volume) + action.delta);
        case "toggle-mute":
          return toggleMute();
        case "toggle-captions":
          return toggleCaptions(!captionsOn);
        case "toggle-fullscreen":
          return toggleFullscreen();
        case "toggle-theatre":
          return onToggleTheatre();
        case "toggle-miniplayer":
          return toggleMiniplayer();
        case "speed-step":
          return setPlaybackRate(steppedPlaybackRate(playbackRate, action.direction));
        case "next-video":
          onNext?.();
          return;
        case "previous-video":
          onPrevious?.();
          return;
        case "focus-search": {
          // The masthead is another slice's. Reaching for its input by the
          // attribute it is *measured* to carry (R8 §3.1, `name="search_query"`)
          // rather than importing it keeps the coupling to one selector, and a
          // page without a search box simply does nothing.
          const input = document.querySelector<HTMLInputElement>(
            'input[name="search_query"]',
          );
          input?.focus();
          return;
        }
        case "dismiss":
          if (document.fullscreenElement !== null) toggleFullscreen();
          return;
        case "caption-font-size":
          return setCaptionSettings((settings) => ({
            ...settings,
            fontScale: steppedScale(
              CAPTION_FONT_SCALES,
              settings.fontScale,
              action.direction,
            ),
          }));
        case "caption-text-opacity":
          return setCaptionSettings((settings) => ({
            ...settings,
            textOpacity: cycledOpacity(settings.textOpacity),
          }));
        case "caption-window-opacity":
          return setCaptionSettings((settings) => ({
            ...settings,
            windowOpacity: cycledOpacity(settings.windowOpacity),
          }));
      }
    },
    [
      captionsOn,
      currentTime,
      duration,
      muted,
      onNext,
      onPrevious,
      onToggleTheatre,
      playbackRate,
      seekTo,
      setPlaybackRate,
      setVolume,
      toggleCaptions,
      toggleFullscreen,
      toggleMiniplayer,
      toggleMute,
      togglePlay,
      volume,
    ],
  );

  const latest = useRef({ run, playing, captionsAvailable, captionsOn, frameRate, noteActivity });
  // Written after every render rather than during one: a ref is not part of the
  // render output, and mutating it mid-render is how a component ends up
  // reading a value the paint never saw. The listener below reads it at event
  // time, which is always after the commit.
  useEffect(() => {
    latest.current = { run, playing, captionsAvailable, captionsOn, frameRate, noteActivity };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A control that already handled the key — the scrubber's own `←`/`→`,
      // the menu's `↑`/`↓` — marks it. Acting again would seek twice.
      if (event.defaultPrevented) return;
      // research/07 §6.1: bail before touching the key whenever focus is in a
      // text-entry surface. The search box and the comment composer are both on
      // this page, and this one line is what keeps typing "like" in a comment
      // from seeking, muting and toggling captions.
      if (isTypingContext(event.target)) return;

      const state = latest.current;
      const resolved = resolveShortcut(event, {
        paused: !state.playing,
        captionsAvailable: state.captionsAvailable,
        captionsOn: state.captionsOn,
        frameRate: state.frameRate,
      });
      if (resolved === null) return;

      // Space scrolls the page and `/` opens Firefox's quick-find; a shortcut
      // that fires *and* does the browser's thing is worse than neither.
      event.preventDefault();
      state.noteActivity();
      state.run(resolved.action);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /* --------------------------------------------------------------- nudge -- */

  const pinnedId = engineState?.pinnedQualityId ?? null;
  const rebufferCount = engineState?.metrics.rebufferCount ?? 0;

  /**
   * The rebuffer count at the moment the pin was set.
   *
   * Adjusted **during render** rather than in an effect, which is React's own
   * pattern for state that has to track a prop. An effect would run one frame
   * too late: the render that first sees a new pin would still be comparing
   * against the previous baseline, and a video that had already stalled three
   * times under Auto would accuse the pin of those stalls for exactly one
   * painted frame. Setting state here re-renders before anything is shown.
   */
  const [pinBaseline, setPinBaseline] = useState<{
    readonly pin: string | null;
    readonly rebuffers: number;
  }>({ pin: null, rebuffers: 0 });

  if (pinBaseline.pin !== pinnedId) {
    setPinBaseline({ pin: pinnedId, rebuffers: rebufferCount });
    if (nudgeDismissed) setNudgeDismissed(false);
  }

  const pinnedOption = useMemo(
    () => engineState?.qualities.find((option) => option.id === pinnedId) ?? null,
    [engineState?.qualities, pinnedId],
  );

  const struggling =
    !nudgeDismissed &&
    pinnedOption !== null &&
    engineState !== null &&
    // Only the laddered path can be struggling *at a pin*: the progressive
    // player reports `pinnedQualityId` for its one loaded file, and there is
    // nothing for it to switch to.
    engineState.mode !== "progressive" &&
    rebufferCount - pinBaseline.rebuffers >= STRUGGLE_REBUFFER_COUNT;

  /* ---------------------------------------------------------------- view -- */

  const bufferedSeconds = currentTime + (engineState?.bufferedAheadSeconds ?? 0);
  const autoAvailable = (engineState?.mode ?? "media-source") !== "progressive";

  return (
    <div
      ref={containerRef}
      data-player=""
      data-theatre={theatre ? "" : undefined}
      className={clsx("relative isolate w-full overflow-hidden bg-black", className)}
      // A 16:9 box, which is what the measured player is (1344×756). The video
      // is `object-contain` inside it so a 4:3 or vertical source letterboxes
      // rather than stretching — `ytd-watch-flexy` carries
      // `is-four-three-to-sixteen-nine-video_` for exactly this case.
      style={{ aspectRatio: "16 / 9" }}
      onPointerMove={noteActivity}
      onPointerLeave={() => {
        if (playing && !menuOpen) setControlsVisible(false);
      }}
    >
      {/* The caption `<track>` children are rendered below when the video has
          one; a video with no caption asset cannot be given one here. */}
      <video
        ref={videoRef}
        data-player-video=""
        className="size-full object-contain"
        // Never `controls`: the whole point of this slice is that the chrome is
        // ours, and a native control bar would also re-introduce the native
        // caption rendering research/07 §2 rejects.
        playsInline
        poster={posterUrl ?? undefined}
        title={title}
        onClick={togglePlay}
      >
        {captionTracks.map((caption) => (
          <track
            key={caption.src}
            kind="captions"
            src={caption.src}
            srcLang={caption.srcLang}
            label={caption.label}
            // `default` gets the browser to parse and select the track. Its
            // mode is immediately forced to `hidden` by `useActiveCues`, which
            // is research/07 §2's recommendation verbatim: take the browser's
            // WebVTT parser for free and do all the painting ourselves.
            default={caption.default}
          />
        ))}
      </video>

      <CaptionLayer
        cues={cues}
        settings={captionSettings}
        // The bar's height plus its progress strip when the chrome is up, and a
        // small inset when it is not. This is the positioning research/07 §2
        // says no native `<track>` implementation exposes a hook for.
        bottomInset={controlsVisible ? CONTROL_BAR_HEIGHT + 16 : 16}
        playerHeight={playerHeight}
      />

      {engineError !== null ? (
        <div
          role="alert"
          data-player-error=""
          className="absolute inset-0 grid place-items-center p-8 text-center text-overlay-primary"
        >
          <p className="max-w-prose text-body">{engineError.message}</p>
        </div>
      ) : null}

      {struggling && pinnedOption !== null ? (
        <div
          data-player-nudge=""
          className="absolute bottom-[76px] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-cozy px-4 py-3 text-body"
          style={{
            background: "var(--yt-player-panel)",
            color: "var(--yt-player-ink)",
            backdropFilter: "blur(16px)",
          }}
        >
          <span>Struggling to play at {pinnedOption.name}</span>
          <button
            type="button"
            data-player-nudge-accept=""
            className="font-[var(--yt-weight-medium)] underline"
            onClick={() => selectQuality("auto")}
          >
            Switch to Auto
          </button>
          <button
            type="button"
            data-player-nudge-dismiss=""
            aria-label="Dismiss"
            className="opacity-70"
            onClick={() => setNudgeDismissed(true)}
          >
            ✕
          </button>
        </div>
      ) : null}

      <PlayerControls
        playing={playing}
        onTogglePlay={togglePlay}
        onNext={onNext}
        volume={volume}
        muted={muted}
        onVolumeChange={setVolume}
        onToggleMute={toggleMute}
        currentTime={currentTime}
        duration={duration}
        bufferedSeconds={bufferedSeconds}
        onSeek={seekTo}
        playbackRate={playbackRate}
        onSelectPlaybackRate={setPlaybackRate}
        theatre={theatre}
        onToggleTheatre={onToggleTheatre}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        miniplayer={miniplayer}
        onToggleMiniplayer={toggleMiniplayer}
        visible={controlsVisible}
        onActivity={noteActivity}
        onSettingsOpenChange={setMenuOpen}
        captionsAvailable={captionsAvailable}
        captionsOn={captionsOn}
        captionsLabel={captionsLabel}
        onToggleCaptions={toggleCaptions}
        captionSettings={captionSettings}
        onCaptionSettingsChange={setCaptionSettings}
        qualities={engineState?.qualities ?? []}
        activeQualityId={engineState?.activeQualityId ?? null}
        pinnedQualityId={pinnedId}
        autoAvailable={autoAvailable}
        onSelectQuality={selectQuality}
      />

      {/*
        research/07 §7.5: a polite `role="status"` for state changes that are
        not already colocated with a focusable, labelled control. Play/pause is
        deliberately absent — the button's own `aria-pressed` and flipping label
        already say it, and announcing it too would talk over the reader on
        every press.
      */}
      <div role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
