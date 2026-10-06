/**
 * `canonicalize` and `hashState` — the desync fence (D16, F36, R91, R92).
 *
 * Every action row carries a 64-bit digest over a **canonical** serialisation
 * of the authoritative state, and every client asserts it after folding. For
 * that to mean anything the serialisation has to be byte-identical everywhere:
 *
 * - **keys sorted**, so no engine's property order can change the bytes;
 * - **no `undefined`**, so an optional field present-as-undefined and absent
 *   hash alike;
 * - **integers printed as integers**, and the one genuine fraction in the
 *   state (`rules.dominationThreshold`) printed on a fixed 6-decimal grid, so
 *   a float that arrived through JSON and a float that was computed agree;
 * - **the map is never covered** (F1): `GameState` carries only `mapSlug`, so
 *   two clients agreeing on a hash have agreed about the game, not about the
 *   geometry.
 *
 * `hashState` **asserts `state.fogged === false`** (F36). A masked view is a
 * different byte string per viewer, so hashing one would make every fog game
 * look desynced; the assertion turns that into a loud, immediate failure
 * instead. It is the one place in the engine that throws on purpose, and it is
 * not an `apply` path (R86 is about illegal *actions*).
 */
import { fnv1a64Hex } from "./prng";
import type { GameState } from "./types";

/** Non-integers are printed on this grid, so arithmetic and JSON agree. */
const FRACTION_DIGITS = 6;

function canonNumber(n: number): string {
  if (!Number.isFinite(n)) return "null";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(FRACTION_DIGITS);
}

function canonValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return canonNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonValue(record[k])}`).join(",")}}`;
  }
  // Functions and symbols cannot appear in a GameState; drop them rather than
  // letting them differ between engines.
  return "null";
}

/**
 * The canonical byte string of a state: sorted keys, no `undefined`, integers
 * as integers. Works on any state, fogged or not — it is `hashState` that
 * refuses a view.
 */
export function canonicalize(state: GameState): string {
  return canonValue(state);
}

/**
 * The 64-bit hex digest every action row carries (D16). Asserts the state is
 * authoritative (F36).
 */
export function hashState(state: GameState): string {
  if (state.fogged !== false) {
    throw new Error("hashState: refusing to hash a fogged view — hash authoritative state only (F36)");
  }
  return fnv1a64Hex(canonicalize(state));
}
