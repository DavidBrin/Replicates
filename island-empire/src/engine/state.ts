/**
 * `createInitialState` (SPEC §4, §3.5, §3.8): turns a validated `MapDefinition`
 * into turn-0 state. Seat 0 moves first, its units are ready, nobody has
 * collected income yet (D36), and `turnStart` is the snapshot UNDO replays from.
 */
import { coreOf, openDraft, setProvince, setTile, tileAt } from "./draft";
import { rowMajor } from "./grid";
import { detectAllProvinces } from "./provinces";
import { normaliseSeed } from "./prng";
import { provincesOf } from "./rules";
import {
  RULES,
  type Difficulty,
  type GameState,
  type MapDefinition,
  type PlayerState,
  type RuntimeTile,
} from "./types";
import { validateMap } from "./validate";

export interface InitialStateOptions {
  /** Per-seat kind / difficulty, overriding `map.players[i].kind` (the session's seats). */
  seats?: Array<{ kind: "human" | "ai"; aiDifficulty?: Difficulty }>;
  /** Campaign difficulty; selects the row of `map.difficulty` scaling AI start gold. */
  difficulty?: Difficulty;
}

export function createInitialState(map: MapDefinition, seed: number, options: InitialStateOptions = {}): GameState {
  const check = validateMap(map);
  if (!check.valid) throw new Error(`createInitialState: invalid map — ${check.errors.join("; ")}`);

  const players: PlayerState[] = map.players.map((p, i) => {
    const seat = options.seats?.[i];
    const kind = seat?.kind ?? (p.kind === "empty" ? null : p.kind);
    if (kind === null) throw new Error(`createInitialState: seat ${i} is empty and no seats override was given`);
    const aiDifficulty = kind === "ai" ? (seat?.aiDifficulty ?? p.aiDifficulty ?? options.difficulty ?? "normal") : null;
    return { index: p.index, colour: p.colour, kind, aiDifficulty, eliminated: false };
  });

  const tiles: RuntimeTile[] = map.tiles.map((t, i) => {
    const x = i % map.width;
    const y = (i - x) / map.width;
    return {
      x,
      y,
      terrain: t.terrain,
      owner: t.owner,
      building: t.building,
      unit: t.unit === null ? null : { level: t.unit.level, readyToMove: t.owner === 0 },
      decoration: t.decoration,
      road: t.road,
      graveAge: t.terrain === "grave" ? (t.graveAge ?? 0) : 0,
      provinceId: null,
    };
  });

  const d = openDraft({
    width: map.width,
    height: map.height,
    biome: map.biome,
    tiles,
    provinces: {},
    players,
    activePlayerIndex: 0,
    turnNumber: 0,
    rng: { seed: normaliseSeed(seed) },
    outcome: null,
  });
  detectAllProvinces(d);

  // Starting gold (SPEC §3.2, §3.5, D14): scaled for AI seats by the difficulty table.
  const core = coreOf(d);
  for (const player of players) {
    const slot = map.players[player.index];
    if (slot === undefined) continue;
    let gold = slot.startGold;
    // Only a campaign map carries a difficulty table; generated and custom
    // maps keep their authored gold (10 per province — D15), whatever the
    // AI tier (codex round 3).
    if (player.kind === "ai" && map.difficulty !== null) {
      const difficulty = options.difficulty ?? player.aiDifficulty ?? "normal";
      const multiplier = map.difficulty[difficulty]?.aiStartGoldMultiplier ?? RULES.aiStartGoldMultiplier[difficulty];
      gold = Math.round(gold * multiplier);
    }
    const provinces = provincesOf(core, player.index).sort(
      (a, b) => rowMajor(map.width, a.city) - rowMajor(map.width, b.city),
    );
    provinces.forEach((p, i) => {
      setProvince(d, p.id, { gold: map.startGoldPerProvince === true || i === 0 ? gold : 0 });
    });
  }

  // Cities placed by detection cleared nothing else; make sure lone units start unready unless seat 0.
  for (let i = 0; i < d.tiles.length; i++) {
    const t = tileAt(d, i);
    if (t.unit !== null && t.owner !== 0 && t.unit.readyToMove) setTile(d, i, { unit: { ...t.unit, readyToMove: false } });
  }

  const finalCore = coreOf(d);
  return { ...finalCore, history: [], turnStart: finalCore };
}
