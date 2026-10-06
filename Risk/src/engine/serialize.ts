/**
 * `GameState` JSON round-trips, in a versioned envelope (R92, D16).
 *
 * The envelope is what lets a stored autosave or a snapshot row be migrated
 * rather than silently misread: `deserializeState` refuses a foreign version
 * instead of handing back a half-understood state. It throws, which is
 * deliberate and is not an `apply` path — R86 governs illegal *actions*, not a
 * corrupt file.
 *
 * `hashState(deserializeState(serializeState(s))) === hashState(s)` for every
 * state, which T5 asserts over generated states: the digest is computed from a
 * canonical walk (`hash.ts`), so a JSON round-trip cannot move it.
 */
import { RULESET_VERSION, type GameState } from "./types";

/** The envelope version, bumped only by a shape change (R92). */
export const STATE_FORMAT_VERSION = 1;

export function serializeState(state: GameState): string {
  return JSON.stringify({ v: STATE_FORMAT_VERSION, state });
}

export function deserializeState(json: string): GameState {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) throw new Error("deserializeState: not an object");
  const envelope = parsed as { v?: unknown; state?: unknown };
  if (envelope.v !== STATE_FORMAT_VERSION) {
    throw new Error(`deserializeState: unsupported envelope version ${String(envelope.v)}`);
  }
  const state = envelope.state as GameState | undefined;
  if (
    typeof state !== "object" ||
    state === null ||
    !Array.isArray(state.territories) ||
    !Array.isArray(state.seats) ||
    !Array.isArray(state.turnOrder) ||
    typeof state.mapSlug !== "string" ||
    typeof state.rules !== "object"
  ) {
    throw new Error("deserializeState: malformed state");
  }
  if (typeof state.version !== "number") throw new Error("deserializeState: missing ruleset version");
  if (state.version > RULESET_VERSION) {
    throw new Error(`deserializeState: state was produced under a newer ruleset (${state.version})`);
  }
  return state;
}
