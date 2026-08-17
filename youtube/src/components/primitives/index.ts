/**
 * The primitive layer.
 *
 * Five components, because the measured product has five: R9 §14's conclusion
 * from the signed-in pass is that **one** Button with the
 * variant × palette × size × icon-mode matrix, **one** Chip, and one Lockup
 * cover home, subscriptions, history, You, playlists, watch and search
 * between them. The Lockup is the feed slice's — it is a card, not a
 * primitive — so what lands here is the button, the chip, the avatar, and the
 * two overlay surfaces those surfaces open: the menu and the contextual sheet.
 *
 * Everything is re-exported from one place so a later slice imports
 * `@/components/primitives` and never has to know which file a thing lives in.
 * The icon set stays at `@/components/icons`: it is a different kind of thing,
 * it is large, and mixing it in here would mean every import of `Button`
 * pulled in thirty SVGs.
 */

export {
  Button,
  ButtonLink,
  buttonClassName,
  type ButtonAppearance,
  type ButtonLinkProps,
  type ButtonPalette,
  type ButtonProps,
  type ButtonSegment,
  type ButtonSize,
  type ButtonVariant,
} from "./button";

export { Chip, ChipBar, type ChipBarProps, type ChipProps } from "./chip";

export {
  Avatar,
  avatarSizePx,
  type AvatarProps,
  type AvatarSize,
} from "./avatar";

export {
  Menu,
  MenuItem,
  MenuSection,
  type MenuItemProps,
  type MenuProps,
  type MenuTriggerProps,
} from "./menu";

export {
  Sheet,
  SheetListItem,
  type SheetListItemProps,
  type SheetProps,
  type SheetTriggerProps,
} from "./sheet";
