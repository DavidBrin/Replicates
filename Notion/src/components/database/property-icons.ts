/**
 * Icon resolution for property types and view types.
 *
 * `PropertyTypeHandler.icon` is a *string* — the handler layer is deliberately
 * free of React so it can be unit-tested and reused server-side. This module is
 * the one place that turns those names into components.
 *
 * It uses an explicit map rather than lucide's `icons` barrel: importing that
 * object pulls all ~1,600 icons into the bundle and defeats tree-shaking. The
 * fallback keeps an unrecognised handler renderable instead of crashing, which
 * matters because a new handler can be registered without touching this file.
 */

import {
  AlignLeft,
  AtSign,
  Calendar,
  ChevronDownCircle,
  Clock,
  Columns3,
  Hash,
  LayoutGrid,
  Link,
  List,
  LoaderCircle,
  SquareCheck,
  Table2,
  Type,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ViewType } from "@/lib/model/types";

/**
 * Keyed by the `icon` string each `PropertyTypeHandler` declares.
 *
 * Exported as a map, and indexed at the call site, rather than wrapped in a
 * `propertyIcon(name)` helper: a *call* returning a capitalised value reads to
 * React's lint rules as a component being constructed during render, while a
 * lookup on a module-level constant is correctly seen as a stable reference.
 */
export const PROPERTY_ICONS: Record<string, LucideIcon> = {
  Type,
  AlignLeft,
  Hash,
  ChevronDownCircle,
  List,
  LoaderCircle,
  Users,
  Calendar,
  SquareCheck,
  Link,
  AtSign,
  Clock,
};

/** Used when a handler declares an icon this module has not been taught. */
export const FALLBACK_PROPERTY_ICON: LucideIcon = Type;

/** Tab-strip icon per view type, matching Notion's own glyph choices. */
export const VIEW_TYPE_ICONS: Record<ViewType, LucideIcon> = {
  board: Columns3,
  table: Table2,
  list: List,
  calendar: Calendar,
  gallery: LayoutGrid,
};

/** Menu label per view type. */
export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  board: "Board",
  table: "Table",
  list: "List",
  calendar: "Calendar",
  gallery: "Gallery",
};
