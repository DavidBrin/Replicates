import clsx, { type ClassValue } from "clsx";

/**
 * Join class names, dropping the falsy ones.
 *
 * A one-line wrapper rather than importing `clsx` at every call site, because
 * the class-merging strategy is the sort of thing that changes once (a
 * tailwind-merge pass, a design-token prefix) and would otherwise have to be
 * changed in fifty files.
 */
export function cn(...parts: ClassValue[]): string {
  return clsx(parts);
}
