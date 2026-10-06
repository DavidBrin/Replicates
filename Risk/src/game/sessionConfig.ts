/**
 * The setup-flow store (SPEC §4.14, §5.1).
 *
 * `/new` picks a game type, `/new/map` writes a `MapSource`, `/new/rules`
 * writes the `Rules` and the seat rows, and BATTLE resolves the source into a
 * real `MapFile`. `MapSource` lives here, not in `@/engine/map`: where a map
 * comes from is a setup concern, and S3 owns no file under `src/game/`.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";

import {
  DEFAULT_RULES, MAX_SEATS, type BotTier, type GameConfig, type PlayerColour, type Rules, type SeatConfig,
} from "@/engine/types";

/** S3's `VoronoiOptions` (§4.14), restated because `@/engine/map` is S3's barrel. */
export interface VoronoiOptions {
  readonly territories: number;      // 19 .. 104
  readonly continents: number;       // 4 .. 11
  readonly width: number;
  readonly height: number;
  readonly seaLinks: number;
  readonly name?: string;
}

export type MapSource =
  | { readonly kind: "slug"; readonly slug: string }
  | { readonly kind: "random"; readonly options: VoronoiOptions; readonly seed: string };

export type GameMode = "solo" | "pass-and-play" | "online";
export type MatchFormat = "ffa" | "1v1";

export const DEFAULT_VORONOI: VoronoiOptions = {
  territories: 42, continents: 6, width: 1600, height: 900, seaLinks: 7,
};

export const SEAT_COLOURS: readonly PlayerColour[] = [
  "red", "green", "blue", "yellow", "orange", "pink", "black", "white", "purple",
];

export const BOT_TIERS: readonly BotTier[] = ["beginner", "easy", "medium", "hard", "expert"];

/** Title case for a tier, for the `AI Difficulty: Expert` readout (§7). */
export function tierLabel(tier: BotTier | null): string {
  if (!tier) return "—";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export interface SessionConfigState {
  readonly mode: GameMode;
  readonly format: MatchFormat;
  readonly source: MapSource | null;
  readonly rules: Rules;
  readonly seats: readonly SeatConfig[];
  /** Set by `/new/rules` BATTLE; `/play/*` reads it and refuses a cold load. */
  readonly ready: boolean;
}

export interface SessionConfigActions {
  setMode(mode: GameMode): void;
  setFormat(format: MatchFormat): void;
  setSource(source: MapSource | null): void;
  setRules(patch: Partial<Rules>): void;
  setSeatCount(count: number): void;
  setSeat(index: number, patch: Partial<SeatConfig>): void;
  setReady(ready: boolean): void;
  reset(): void;
}

export type SessionConfigStore = SessionConfigState & SessionConfigActions;

/** The placeholder `defaultSeat` gives the viewer's own seat. */
export const VIEWER_SEAT_PLACEHOLDER = "You";

/**
 * R8/R72 — `winCondition: "capitals"` and the `capitals` modifier are one choice, not two.
 *
 * The win condition is "hold every capital", and the modifier is what puts capitals on the board at
 * all (R8) and gives them their extra defence die (R36). Picking the win condition without the
 * modifier therefore starts a game **nobody can win** — `evaluateOutcome` is looking for capitals
 * that were never dealt — and turning the modifier off underneath the win condition leaves the same
 * unwinnable board. So the coupling is enforced where every rules change already funnels through,
 * rather than in each of the two controls that can break it.
 */
export function coupleCapitals(current: Rules, patch: Partial<Rules>): Partial<Rules> {
  const condition = patch.winCondition ?? current.winCondition;
  return {
    ...patch,
    ...(patch.winCondition === "capitals" ? { capitals: true } : {}),
    ...(patch.capitals === false && condition === "capitals" ? { winCondition: "world" as const } : {}),
  };
}

/** A seat row with the first free colour and a sensible default name. */
export function defaultSeat(index: number, kind: SeatConfig["kind"], tier: BotTier): SeatConfig {
  return {
    kind,
    name: kind === "human"
      ? (index === 0 ? VIEWER_SEAT_PLACEHOLDER : `Player ${index + 1}`)
      : `Bot ${index}`,
    colour: SEAT_COLOURS[index % SEAT_COLOURS.length] as PlayerColour,
    tier: kind === "bot" ? tier : null,
  };
}

/**
 * The viewer's seat takes the display name the identity sheet claimed, so the
 * roster capsule, the `Get Ready` name plate, the turn banner and the avatar
 * initial all read `Northern Warden 21` rather than `You` (SPEC §7: the name
 * plate carries the display name; the *copy* under it keeps `player N`).
 *
 * Only the seat still carrying the `You` placeholder is renamed — a Pass &
 * Play seat the player named in the Modifiers panel keeps its own name, and
 * so does every bot.
 */
export function withIdentityName(
  seats: readonly SeatConfig[], displayName: string | null | undefined,
): readonly SeatConfig[] {
  const name = displayName?.trim();
  if (!name) return seats;
  let renamed = false;
  return seats.map((seat) => {
    if (renamed || seat.kind !== "human" || seat.name !== VIEWER_SEAT_PLACEHOLDER) return seat;
    renamed = true;
    return { ...seat, name };
  });
}

/**
 * Solo: one human and `count - 1` bots. Pass & Play and Online: every seat human — online a
 * human row is an OPEN seat for someone to join (D115). A lobby that opened with the solo
 * pattern was host-plus-bots: full before anyone arrived, so every join was refused.
 */
export function defaultSeats(mode: GameMode, count: number, tier: BotTier): SeatConfig[] {
  return Array.from({ length: count }, (_, i) =>
    defaultSeat(i, mode !== "solo" || i === 0 ? "human" : "bot", tier));
}

/** The seat count a mode opens with: two for the kitchen table, every seat open online. */
export function defaultSeatCount(mode: GameMode, current: number): number {
  if (mode === "pass-and-play") return 2;
  if (mode === "online") return MAX_SEATS;
  return current;
}

function initial(): SessionConfigState {
  return {
    mode: "solo",
    format: "ffa",
    source: null,
    rules: DEFAULT_RULES,
    seats: defaultSeats("solo", 3, DEFAULT_RULES.aiDifficulty),
    ready: false,
  };
}

export function createSessionConfigStore(): StoreApi<SessionConfigStore> {
  return createStore<SessionConfigStore>((set, get) => ({
    ...initial(),

    setMode(mode) {
      const seats = defaultSeats(mode, defaultSeatCount(mode, get().seats.length), get().rules.aiDifficulty);
      set({ mode, seats, ready: false });
    },
    setFormat(format) {
      set({ format, seats: format === "1v1" ? defaultSeats(get().mode, 2, get().rules.aiDifficulty) : get().seats });
    },
    setSource(source) {
      set({ source, ready: false });
    },
    setRules(patch) {
      const rules = { ...get().rules, ...coupleCapitals(get().rules, patch) };
      // The tier on the rules row is the pool every bot seat is drawn from.
      const seats = patch.aiDifficulty
        ? get().seats.map((s) => (s.kind === "bot" ? { ...s, tier: patch.aiDifficulty as BotTier } : s))
        : get().seats;
      set({ rules, seats });
    },
    setSeatCount(count) {
      const clamped = Math.max(2, Math.min(6, Math.floor(count)));
      const current = get().seats;
      const tier = get().rules.aiDifficulty;
      const mode = get().mode;
      const seats = Array.from({ length: clamped }, (_, i) => current[i] ?? defaultSeat(
        i, mode === "pass-and-play" ? "human" : "bot", tier,
      ));
      set({ seats });
    },
    setSeat(index, patch) {
      set({
        seats: get().seats.map((s, i) => {
          if (i !== index) return s;
          const next = { ...s, ...patch };
          // `tier` is non-null iff the seat is a bot (§4.6).
          return { ...next, tier: next.kind === "bot" ? (next.tier ?? get().rules.aiDifficulty) : null };
        }),
      });
    },
    setReady(ready) {
      set({ ready });
    },
    reset() {
      set(initial());
    },
  }));
}

/** The one store the setup routes share. */
export const sessionConfigStore = createSessionConfigStore();

export function useSessionConfig<T>(selector: (s: SessionConfigStore) => T): T {
  return useStore(sessionConfigStore, selector);
}

/** Assemble the `GameConfig` BATTLE hands to `createSession`. */
export function toGameConfig(state: SessionConfigState, mapSlug: string, seed: string): GameConfig {
  return { mapSlug, rules: state.rules, seats: state.seats, seed };
}

/**
 * `sourceKey(config)` — the autosave bucket (§4.15). It hashes everything
 * that shapes the initial state, because anything that changes what a resumed
 * `GameState` even *means* must change the key: the map slug, the seat
 * configuration (who is human or bot and at what tier) and the rules.
 */
export function sourceKey(config: GameConfig): string {
  const seats = config.seats.map((s) => `${s.kind}:${s.tier ?? "-"}:${s.colour}`).join(",");
  const rules = (Object.keys(config.rules) as (keyof Rules)[])
    .sort()
    .map((k) => `${k}=${String(config.rules[k])}`)
    .join(";");
  const text = `${config.mapSlug}|${config.seats.length}|${seats}|${rules}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0);
  return `${config.mapSlug}-${(h >>> 0).toString(36)}`;
}
