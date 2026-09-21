/**
 * Shared pixel-styled primitives (SPEC §12): every slice that wants the
 * measured look imports from here rather than restyling its own.
 */
export { PixelButton, type PixelButtonProps, type PixelButtonVariant } from "./PixelButton";
export { WoodPanel, type WoodPanelProps } from "./WoodPanel";
export { StarRow, Star, type StarRowProps } from "./StarRow";
export { PixelDialog, type PixelDialogProps } from "./PixelDialog";
export { PlayerDot, PLAYER_COLOUR_HEX, PLAYER_COLOUR_VAR } from "./PlayerDot";
