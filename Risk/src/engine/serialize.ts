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

/**
 * The envelope version, bumped only by a shape change (R92).
 *
 * **v2 — `GameState.pendingAlliances` (§4.7).** R80's unanswered offers became a field of the
 * state, and a v1 envelope does not carry it. Leaving the version at 1 made every such envelope a
 * *valid* v1 state that was in fact half understood: `validate`, `legalActions` and `apply` all
 * read `pendingAlliances` and all three threw a `TypeError` on the first alliance question, which
 * is exactly the silent misreading the envelope exists to prevent (codex round 4, finding 3).
 */
/**
 * **v3 — `Rules.neutralHolding` (D106).** The 2-seat neutral became opt-in. Every v1/v2 state with
 * two seats was dealt WITH a neutral, so the migration writes `true` for those and `false`
 * otherwise; `hashState` is unmoved because the rules object only gains a key whose value is what
 * the board already shows.
 */
export const STATE_FORMAT_VERSION = 3;

/** The versions {@link deserializeState} accepts, oldest first. Each needs a {@link MIGRATIONS} step. */
export const SUPPORTED_STATE_FORMAT_VERSIONS: readonly number[] = [1, 2, 3];

/**
 * One step per version, applied in order from the envelope's own version up to the current one.
 *
 * A step takes the raw parsed object and fills in whatever its version did not carry. It is
 * deliberately *additive* and never reinterprets an existing field: a migration that changed the
 * meaning of a stored value would move `hashState`, and R92's promise is that a stored replay keeps
 * playing back.
 */
const MIGRATIONS: Readonly<Record<number, (state: Record<string, unknown>) => Record<string, unknown>>> = {
  // 1 → 2: the field did not exist, so there were no offers in the air.
  1: (state) => ({ ...state, pendingAlliances: state.pendingAlliances ?? [] }),
  // 2 → 3: a two-seat board of that era always had the neutral; everything else never did.
  2: (state) => {
    const rules = (state.rules ?? {}) as Record<string, unknown>;
    if (typeof rules.neutralHolding === "boolean") return state;
    const seats = Array.isArray(state.seats) ? state.seats.length : 0;
    return { ...state, rules: { ...rules, neutralHolding: seats === 2 } };
  },
};

export function serializeState(state: GameState): string {
  return JSON.stringify({ v: STATE_FORMAT_VERSION, state });
}

export function deserializeState(json: string): GameState {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) throw new Error("deserializeState: not an object");
  const envelope = parsed as { v?: unknown; state?: unknown };
  if (typeof envelope.v !== "number" || !SUPPORTED_STATE_FORMAT_VERSIONS.includes(envelope.v)) {
    throw new Error(`deserializeState: unsupported envelope version ${String(envelope.v)}`);
  }
  let migrated = envelope.state;
  if (typeof migrated === "object" && migrated !== null) {
    for (let v = envelope.v; v < STATE_FORMAT_VERSION; v += 1) {
      const step = MIGRATIONS[v];
      if (!step) throw new Error(`deserializeState: no migration from envelope version ${String(v)}`);
      migrated = step(migrated as Record<string, unknown>);
    }
  }
  const state = migrated as GameState | undefined;
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
  // Belt as well as braces: a v2 envelope hand-written without the field is not a version this can
  // migrate, and it must still come back as a state the engine can read (R92, §4.7).
  return Array.isArray(state.pendingAlliances) ? state : { ...state, pendingAlliances: [] };
}
