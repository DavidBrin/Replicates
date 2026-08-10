import { clsx, type ClassValue } from "clsx";

/**
 * Thin wrapper around `clsx` so components import class-name merging from a
 * single, stable place.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(...inputs);
}
