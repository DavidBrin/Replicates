/**
 * The player slice's public surface.
 *
 * Everything a page needs is `Player`. The rest is exported because the pieces
 * are separately meaningful — a Shorts surface wants the caption layer and the
 * keyboard map without the watch-page chrome, and the settings menu's label
 * helpers are the kind of thing two surfaces must not derive twice.
 *
 * The playback *engine* is not re-exported. It lives at `@/media/player` and a
 * caller that needs it should say so; funnelling it through here would make it
 * look like part of the UI, which is the one thing this boundary exists to
 * deny.
 */

export {
  Player,
  type PlayerCaptionTrack,
  type PlayerProps,
} from "./player";

export {
  CONTROLS_AUTOHIDE_MS,
  CONTROL_BAR_HEIGHT,
  CONTROL_BAR_INSET,
  PlayerControls,
  type ControlsCaptionProps,
  type ControlsQualityProps,
  type PlayerControlsProps,
} from "./controls";

export { PROGRESS_BAR_HEIGHT, ProgressBar, type ProgressBarProps } from "./progress-bar";

export {
  SettingsMenu,
  describeRate,
  qualityLabel,
  qualityReadout,
  type SettingsMenuProps,
  type SettingsPanelId,
} from "./settings-menu";

export {
  CAPTION_BASE_HEIGHT_FRACTION,
  CAPTION_FONT_SCALES,
  CAPTION_OPACITIES,
  CaptionLayer,
  DEFAULT_CAPTION_SETTINGS,
  cycledOpacity,
  edgeTextShadow,
  renderCueText,
  steppedScale,
  useActiveCues,
  withAlpha,
  type CaptionEdgeStyle,
  type CaptionLayerProps,
  type CaptionSettings,
  type TextTrackCueLike,
  type TextTrackLike,
} from "./captions";

export {
  ASSUMED_FRAME_RATE,
  PLAYBACK_RATES,
  SEEK_JUMP_SECONDS,
  SEEK_STEP_SECONDS,
  VOLUME_STEP,
  isTypingContext,
  resolveShortcut,
  steppedPlaybackRate,
  type KeyboardEventLike,
  type PlayerAction,
  type ResolvedShortcut,
  type ShortcutContext,
  type ShortcutScope,
} from "./keyboard";
