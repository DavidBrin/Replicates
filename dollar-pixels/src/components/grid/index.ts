export { PixelGrid, type PixelGridProps } from "@/components/grid/PixelGrid";
export { buildClaimIndex, type ClaimIndex } from "@/components/grid/claim-index";
export {
  DEFAULT_THEME,
  hitTest,
  paintBase,
  paintOverlay,
  prepareContext,
  readTheme,
  sizeCanvas,
  type BlockPoint,
  type GridTheme,
  type OverlayState,
  type TileImages,
} from "@/components/grid/paint";
export {
  clampSelection,
  stepZoom,
  useGridPointer,
  type GridPointer,
  type GridPointerOptions,
} from "@/components/grid/use-grid-pointer";
