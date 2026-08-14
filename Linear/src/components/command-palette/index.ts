/** The command palette, the `?` sheet, and the composition the shell mounts. */

export { CommandPalette, type CommandPaletteProps } from "./command-palette";
export {
  ChordHint,
  CommandSurface,
  type CommandSurfaceProps,
} from "./command-surface";
export {
  ShortcutsOverlay,
  type ShortcutsOverlayProps,
} from "./shortcuts-overlay";
export {
  buildCommands,
  buildSubmenu,
  COMMAND_GROUPS,
  EMPTY_CONTEXT,
  groupOrder,
  rankCommands,
  scoreCommand,
  sectionLabel,
  SUBMENU_TITLES,
  SUBMENUS,
  type Command,
  type CommandEffect,
  type CommandGroup,
  type CommandSection,
  type PaletteContext,
  type PaletteIssue,
  type PaletteLabel,
  type PalettePerson,
  type PaletteStatus,
  type PaletteSurface,
  type Submenu,
} from "./commands";
