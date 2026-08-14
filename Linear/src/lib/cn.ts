/**
 * Class-name composition.
 *
 * A one-line wrapper over `clsx`, exported under a short name because every
 * component in `components/ui` merges an incoming `className` onto its own
 * base classes and the call appears several times per file.
 *
 * ## Why there is no `tailwind-merge` here
 *
 * The usual pairing is `twMerge(clsx(...))`, which de-duplicates conflicting
 * Tailwind utilities so a caller's `px-4` beats the component's `px-2`. It is
 * deliberately absent:
 *
 * 1. It costs ~7 kB gzipped in the client bundle and runs a trie lookup on
 *    every render, for a problem this codebase does not have — the components
 *    here take a small, closed set of variants and append `className` last, so
 *    the cascade already resolves ties in the caller's favour for everything
 *    except two utilities of identical specificity in the same layer.
 * 2. Its conflict map is keyed on Tailwind's *default* namespaces. This project
 *    re-points those namespaces at CSS custom properties through
 *    `@theme inline` (`bg-panel`, `text-tertiary`, `border-default`), and a
 *    merger that does not know `panel` is a colour will happily keep both
 *    `bg-panel` and `bg-elevated`.
 *
 * Where a genuine override is needed, the variant belongs in the component's
 * own prop surface rather than in a caller's class string.
 */

import { clsx, type ClassValue } from "clsx";

export type { ClassValue };

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
