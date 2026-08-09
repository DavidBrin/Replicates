/**
 * Maps a Notion colour name onto the CSS custom properties defined in
 * `globals.css`. Components never hard-code a hex value; they ask for a role
 * (pill, dot, wash) and get the token, which is what makes light and dark mode
 * a single source of truth.
 */

import type { NotionColor } from "../model/types";

export interface TagStyle {
  backgroundColor: string;
  color: string;
}

/** Background + text for a select/status pill. */
export function tagStyle(color: NotionColor = "default"): TagStyle {
  return {
    backgroundColor: `var(--tag-${color}-bg)`,
    color: `var(--tag-${color}-fg)`,
  };
}

/** The saturated dot that precedes a status label. */
export function dotColor(color: NotionColor = "default"): string {
  return `var(--tag-${color}-dot)`;
}

/** The faint wash behind a board column. */
export function washColor(color: NotionColor = "default"): string {
  return `var(--tag-${color}-wash)`;
}

/** Text colour for a coloured block (callout text, coloured paragraphs). */
export function textColor(color: NotionColor = "default"): string {
  return color === "default" ? "var(--tex-pri)" : `var(--tag-${color}-fg)`;
}

/** Background for a coloured block such as a callout. */
export function blockBackground(color: NotionColor = "default"): string {
  return color === "default" ? "var(--bac-sec)" : `var(--tag-${color}-bg)`;
}

/** Deterministic avatar tint so a person keeps the same colour everywhere. */
export function avatarStyle(color: NotionColor = "default"): TagStyle {
  return {
    backgroundColor: `var(--tag-${color}-dot)`,
    color: "#ffffff",
  };
}
