import { useEffect, useState } from "react";
import { create } from "zustand";

import { fx } from "@/engine/fixed";
import type {
  FighterDef,
  FighterPalette,
  MatchOutcome,
  MatchRules,
  Platform,
  StageDef,
} from "@/engine/types";

/* ==========================================================================
   What the menus need from the roster
   ==========================================================================

   The menus read a *projection* of `FighterDef` / `StageDef` rather than the
   definitions themselves. Two reasons, both practical:

   1. A character select screen needs a name, a number, a series, a blurb and
      five colours. It has no business knowing a fighter's air acceleration or
      the frame data of its up-smash, and typing it against the whole
      definition would couple every menu re-render to moveset edits.
   2. The tables live in `src/fighters` and `src/stages`, which are authored
      separately. A narrow projection is a seam the menus can be developed and
      tested against before those tables exist — see `loadRoster` below.
   ========================================================================== */

export type MenuPalette = Omit<FighterPalette, "alts">;

export interface MenuFighter {
  readonly id: string;
  readonly name: string;
  readonly series: string;
  /** Ultimate's fighter number. The character select screen orders by it. */
  readonly number: number;
  readonly blurb: string;
  readonly palette: MenuPalette;
}

export interface StageGeometry {
  readonly platforms: readonly Platform[];
  readonly blastZone: StageDef["blastZone"];
}

/**
 * A stage with all three of its forms already resolved.
 *
 * Ultimate's Ω and Battlefield forms are not variations on a stage — they are
 * Final Destination's and Battlefield's geometry wearing another stage's skin,
 * which is why every Ω form in the game plays identically. Resolving all three
 * at projection time means the stage select screen can draw the form toggle's
 * effect without knowing that rule, and without re-deriving it per render.
 */
export interface MenuStage {
  readonly id: string;
  readonly name: string;
  readonly series: string;
  readonly forms: Readonly<Record<StageForm, StageGeometry>>;
}

export interface Roster {
  readonly fighters: readonly MenuFighter[];
  readonly stages: readonly MenuStage[];
  /** False while the menus are running on the spec-derived stand-in below. */
  readonly live: boolean;
}

export function projectFighter(def: FighterDef): MenuFighter {
  const { primary, secondary, accent, skin, outline } = def.palette;
  return {
    id: def.id,
    name: def.name,
    series: def.series,
    number: def.number,
    blurb: def.blurb,
    // Named rather than spread-minus-`alts`: the menus draw one costume, and
    // listing the five colours they use says which five those are.
    palette: { primary, secondary, accent, skin, outline },
  };
}

function geometryOf(def: StageGeometry): StageGeometry {
  return { platforms: def.platforms, blastZone: def.blastZone };
}

/**
 * `transform` is the stage module's own form transform when it has one, so the
 * preview shows the geometry the simulation will actually load rather than an
 * approximation of it. Without a module — the stand-in path — the caller
 * supplies the two templates instead, which is the same rule expressed with
 * the same data.
 */
export function projectStage(
  def: StageDef,
  transform: (stage: StageDef, form: StageForm) => StageDef,
): MenuStage {
  return {
    id: def.id,
    name: def.name,
    series: def.series,
    forms: {
      normal: geometryOf(def),
      battlefield: geometryOf(transform(def, "battlefield")),
      omega: geometryOf(transform(def, "omega")),
    },
  };
}

/* ==========================================================================
   The stand-in roster
   ==========================================================================

   Eight fighters and six stages transcribed from SPEC §7 and §8, used only
   when `@/fighters` and `@/stages` cannot be loaded — which is the case while
   those modules are still being written, and never once they exist. It carries
   only the fields the menus draw, so there is nothing here that can disagree
   with the simulation: no weights, no frame data, no hitboxes.

   The geometry is Q12 fixed-point, like the real tables, so no consumer ever
   has to ask which units it is holding. The screens are unit-agnostic anyway —
   every stage diagram normalises against its own definition's extents rather
   than against an absolute scale — but a stand-in that quietly used a
   different contract would be a trap for whoever writes the next consumer.
   ========================================================================== */

const STANDIN_FIGHTERS: readonly MenuFighter[] = [
  {
    id: "mario",
    name: "Mario",
    series: "Super Mario",
    number: 1,
    blurb: "The baseline every other fighter is read against.",
    palette: { primary: "#e52521", secondary: "#0b4ea2", accent: "#ffd21e", skin: "#f3c193", outline: "#180f08" },
  },
  {
    id: "donkeyKong",
    name: "Donkey Kong",
    series: "Donkey Kong",
    number: 2,
    blurb: "Cargo throw and a giant punch, on the heaviest frame here.",
    palette: { primary: "#6b3b1c", secondary: "#3d2010", accent: "#e2242a", skin: "#c98a52", outline: "#150c05" },
  },
  {
    id: "link",
    name: "Link",
    series: "The Legend of Zelda",
    number: 3,
    blurb: "Bomb, boomerang and arrow — three projectiles at once.",
    palette: { primary: "#3f8f3a", secondary: "#245a26", accent: "#d9c37a", skin: "#f0c9a0", outline: "#12180c" },
  },
  {
    id: "samus",
    name: "Samus",
    series: "Metroid",
    number: 4,
    blurb: "A charge shot held between stocks, and a zoner's patience.",
    palette: { primary: "#e2601a", secondary: "#c0202a", accent: "#3fd0d8", skin: "#f2c9a4", outline: "#160c06" },
  },
  {
    id: "kirby",
    name: "Kirby",
    series: "Kirby",
    number: 6,
    blurb: "Six jumps, the worst air speed, and a ruinous back air.",
    palette: { primary: "#f292bc", secondary: "#d8628f", accent: "#e2242a", skin: "#f7b7d2", outline: "#2a0d19" },
  },
  {
    id: "fox",
    name: "Fox",
    series: "Star Fox",
    number: 7,
    blurb: "The fastest faller alive, a reflector, and a frame-2 up smash.",
    palette: { primary: "#c08a3e", secondary: "#f2f2f2", accent: "#3f7fd0", skin: "#e8b878", outline: "#1a1206" },
  },
  {
    id: "pikachu",
    name: "Pikachu",
    series: "Pokémon",
    number: 10,
    blurb: "A two-segment Quick Attack and a hurtbox that keeps missing.",
    palette: { primary: "#f6d02f", secondary: "#8a5a1a", accent: "#e2242a", skin: "#f6d02f", outline: "#241a04" },
  },
  {
    id: "marth",
    name: "Marth",
    series: "Fire Emblem",
    number: 13,
    blurb: "The tipper — the blade's last inch does markedly more.",
    palette: { primary: "#2f5fb0", secondary: "#16305e", accent: "#e8d47a", skin: "#f2c9a4", outline: "#0b1226" },
  },
];

/**
 * The stand-in's geometry goes through `fx` for the same reason the real
 * tables do: `StageDef` is fixed-point by contract, and a stand-in in plain
 * units would be a different contract that every consumer would then have to
 * ask which one it was holding.
 */
function plat(
  x: number,
  y: number,
  halfWidth: number,
  soft: boolean,
  motion?: { kind: "sweep"; amplitude: number; periodFrames: number },
): Platform {
  return {
    x: fx(x),
    y: fx(y),
    halfWidth: fx(halfWidth),
    soft,
    ledges: !soft,
    motion: motion ? { ...motion, amplitude: fx(motion.amplitude) } : undefined,
  };
}

function bz(left: number, right: number, top: number, bottom: number): StageDef["blastZone"] {
  return { left: fx(left), right: fx(right), top: fx(top), bottom: fx(bottom) };
}

interface RawStage extends StageGeometry {
  readonly id: string;
  readonly name: string;
  readonly series: string;
}

const STANDIN_RAW: readonly RawStage[] = [
  {
    id: "battlefield",
    name: "Battlefield",
    series: "Super Smash Bros.",
    platforms: [
      plat(0, 0, 79.99, false),
      plat(-57.6, 54.4, 28.75, true),
      plat(57.6, 54.4, 28.75, true),
      plat(0, 108.8, 28.75, true),
    ],
    blastZone: bz(-240, 240, 192, -140),
  },
  {
    id: "finalDestination",
    name: "Final Destination",
    series: "Super Smash Bros.",
    platforms: [plat(0, 0, 80, false)],
    blastZone: bz(-240, 240, 180, -140),
  },
  {
    id: "smallBattlefield",
    name: "Small Battlefield",
    series: "Super Smash Bros.",
    platforms: [plat(0, 0, 80, false), plat(-48.5, 36, 24, true), plat(48.5, 36, 24, true)],
    blastZone: bz(-240, 240, 180, -140),
  },
  {
    id: "smashville",
    name: "Smashville",
    series: "Animal Crossing",
    platforms: [
      plat(0.6, 0, 69.65, false),
      plat(0, 56, 28, true, { kind: "sweep", amplitude: 72, periodFrames: 460 }),
    ],
    blastZone: bz(-229, 230, 190, -115),
  },
  {
    id: "townAndCity",
    name: "Town & City",
    series: "Animal Crossing",
    platforms: [
      plat(0.72, 0, 82.5, false),
      plat(-58, 44, 26, true),
      plat(58, 44, 26, true),
      plat(0, 88, 26, true),
    ],
    blastZone: bz(-230, 230, 195, -118),
  },
  {
    id: "pokemonStadium2",
    name: "Pokémon Stadium 2",
    series: "Pokémon",
    platforms: [plat(0, 0, 93.78, false), plat(-57.5, 44, 27.5, true), plat(57.5, 44, 27.5, true)],
    blastZone: bz(-250, 250, 180, -125),
  },
];

/**
 * The stand-in's forms are composed the same way the real module composes
 * them: Battlefield's geometry for the Battlefield form, Final Destination's
 * for Ω. Deriving the templates from entries in this very list rather than
 * writing them out twice is what keeps the two consistent.
 */
const STANDIN_STAGES: readonly MenuStage[] = STANDIN_RAW.map((stage) => ({
  id: stage.id,
  name: stage.name,
  series: stage.series,
  forms: {
    normal: geometryOf(stage),
    battlefield: geometryOf(STANDIN_RAW[0]),
    omega: geometryOf(STANDIN_RAW[1]),
  },
}));

export const STANDIN_ROSTER: Roster = {
  fighters: STANDIN_FIGHTERS,
  stages: STANDIN_STAGES,
  live: false,
};

/* ==========================================================================
   Loading the real tables
   ==========================================================================

   `@/fighters` and `@/stages` are imported *lazily*, at call time, and their
   absence is caught rather than allowed to throw. That is not defensive
   programming for its own sake: the menus and the roster are built in
   parallel, and an eagerly-imported table that does not exist yet takes down
   every screen in the app rather than one panel of it.

   The result is memoised on the promise, not on the value, so twenty portraits
   mounting at once produce one import rather than twenty.
   ========================================================================== */

/**
 * Both module shapes are described optionally and probed at runtime.
 *
 * The tables are authored in another module by another hand, and the exact
 * names it settles on — `getAllStages()` or a `STAGES` constant — are not
 * something the menus should force. Reading whichever it exports costs a
 * handful of lines here and removes a reason for the two to have to agree in
 * advance; getting it wrong shows up as a stand-in roster, not a blank screen.
 */
interface FighterModule {
  getAllFighters?: () => readonly FighterDef[];
  FIGHTERS?: readonly FighterDef[];
  ROSTER?: readonly FighterDef[];
}

interface StageModule {
  getAllStages?: () => readonly StageDef[];
  STAGES?: readonly StageDef[];
  stageForm?: (stage: StageDef, form: StageForm) => StageDef;
  getStage?: (id: string) => StageDef | undefined;
}

let rosterPromise: Promise<Roster> | null = null;
let stageModule: StageModule | null = null;

async function loadFighterModule(): Promise<FighterModule | null> {
  try {
    return (await import("@/fighters")) as unknown as FighterModule;
  } catch {
    return null;
  }
}

async function loadStageModule(): Promise<StageModule | null> {
  try {
    return (await import("@/stages")) as unknown as StageModule;
  } catch {
    return null;
  }
}

function fightersFrom(mod: FighterModule | null): readonly FighterDef[] {
  return mod?.getAllFighters?.() ?? mod?.FIGHTERS ?? mod?.ROSTER ?? [];
}

function stagesFrom(mod: StageModule | null): readonly StageDef[] {
  return mod?.getAllStages?.() ?? mod?.STAGES ?? [];
}

export function loadRoster(): Promise<Roster> {
  rosterPromise ??= (async () => {
    const [fighterModule, loadedStages] = await Promise.all([loadFighterModule(), loadStageModule()]);
    stageModule = loadedStages;

    const fighters = fightersFrom(fighterModule).map(projectFighter);
    const rawStages = stagesFrom(loadedStages);
    // Without a form transform there is nothing honest to draw for the other
    // two forms, so the whole stage table falls back rather than half of it.
    const transform = loadedStages?.stageForm;
    const stages = transform ? rawStages.map((s) => projectStage(s, transform)) : [];

    // Each half falls back independently: a landed roster shows through even
    // if the stage table is still in flight, and vice versa.
    return {
      fighters: fighters.length ? sortByNumber(fighters) : STANDIN_ROSTER.fighters,
      stages: stages.length ? stages : STANDIN_ROSTER.stages,
      live: Boolean(fighters.length && stages.length),
    };
  })();

  return rosterPromise;
}

/**
 * The id `/play` should load, with the form folded into it.
 *
 * `GameState.stageId` is one string — a form has to travel inside the id
 * rather than beside it, or rollback has two fields that can disagree. The
 * suffix is taken from the stage module's own transform whenever it is loaded,
 * so the encoding is read from the authority rather than restated here; the
 * literal fallback only applies before that module exists.
 */
export function stageIdForForm(baseId: string, form: StageForm): string {
  if (form === "normal") return baseId;
  const stage = stageModule?.getStage?.(baseId);
  if (stage && stageModule?.stageForm) return stageModule.stageForm(stage, form).id;
  return `${baseId}-${form}`;
}

/** Test seam: drops the memo so a suite can observe a fresh load. */
export function resetRosterCache(): void {
  rosterPromise = null;
  stageModule = null;
}

function sortByNumber(fighters: readonly MenuFighter[]): readonly MenuFighter[] {
  return [...fighters].sort((a, b) => a.number - b.number);
}

/**
 * The roster, available synchronously on first paint.
 *
 * Returning the stand-in immediately and swapping in the real table when it
 * arrives keeps the character select screen from flashing an empty grid, and
 * keeps server and client agreeing on the first render — both start from the
 * same constant.
 */
export function useRoster(): Roster {
  const [roster, setRoster] = useState<Roster>(STANDIN_ROSTER);

  useEffect(() => {
    let live = true;
    void loadRoster().then((next) => {
      if (live) setRoster(next);
    });
    return () => {
      live = false;
    };
  }, []);

  return roster;
}

export function findFighter(roster: Roster, id: string | null): MenuFighter | null {
  if (!id) return null;
  return roster.fighters.find((f) => f.id === id) ?? null;
}

export function findStage(roster: Roster, id: string): MenuStage | null {
  return roster.stages.find((s) => s.id === id) ?? null;
}

/* ==========================================================================
   Controls
   ========================================================================== */

export const CONTROL_ACTIONS = [
  "left",
  "right",
  "up",
  "down",
  "jump",
  "attack",
  "special",
  "shield",
  "grab",
] as const;

export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/** Bindings are `KeyboardEvent.code`, so they survive a non-QWERTY layout. */
export type Bindings = Record<ControlAction, string>;

export const CONTROL_SCHEMES = ["arrows", "mirrored", "rightCluster"] as const;
export type SchemeId = (typeof CONTROL_SCHEMES)[number];

export const SCHEME_INFO: Record<SchemeId, { name: string; hand: string; note: string }> = {
  arrows: {
    name: "Config 1",
    hand: "Arrows to move, left hand on the buttons",
    note: "SPEC §6's first scheme.",
  },
  mirrored: {
    name: "Config 2",
    hand: "WASD to move, right hand on the buttons",
    note: "Config 1 reflected. The mirror is why the two cannot share a keyboard.",
  },
  rightCluster: {
    name: "Config 3",
    hand: "IJKL to move, right-hand cluster on the buttons",
    note: "The disjoint preset, for two players on one keyboard.",
  },
};

export const DEFAULT_BINDINGS: Record<SchemeId, Bindings> = {
  arrows: {
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
    jump: "KeyW",
    attack: "KeyD",
    special: "KeyA",
    shield: "KeyE",
    grab: "KeyQ",
  },
  mirrored: {
    left: "KeyA",
    right: "KeyD",
    up: "KeyW",
    down: "KeyS",
    jump: "ArrowUp",
    attack: "ArrowRight",
    special: "ArrowLeft",
    shield: "ShiftRight",
    grab: "Slash",
  },
  rightCluster: {
    left: "KeyJ",
    right: "KeyL",
    up: "KeyI",
    down: "KeyK",
    jump: "KeyP",
    attack: "KeyO",
    special: "KeyU",
    shield: "Semicolon",
    grab: "Quote",
  },
};

export const ACTION_LABELS: Record<ControlAction, string> = {
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  jump: "Jump",
  attack: "Attack",
  special: "Special",
  shield: "Shield",
  grab: "Grab",
};

/** Human-readable name for a `KeyboardEvent.code`, for the diagram legend. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) {
    const arrows: Record<string, string> = { Up: "↑", Down: "↓", Left: "←", Right: "→" };
    return arrows[code.slice(5)] ?? code;
  }
  const named: Record<string, string> = {
    Space: "Space",
    ShiftLeft: "L Shift",
    ShiftRight: "R Shift",
    ControlLeft: "L Ctrl",
    ControlRight: "R Ctrl",
    AltLeft: "L Alt",
    AltRight: "R Alt",
    Enter: "Enter",
    Backspace: "Bksp",
    Tab: "Tab",
    CapsLock: "Caps",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
  };
  return named[code] ?? code;
}

/**
 * Config 1 and Config 2 are reflections of one another, which means some
 * physical keys carry opposite meanings between them. Computing the overlap
 * rather than listing it keeps the controls screen honest if a binding
 * changes.
 */
export function overlappingKeys(a: Bindings, b: Bindings): string[] {
  const bCodes = new Set(Object.values(b));
  return [...new Set(Object.values(a).filter((code) => bCodes.has(code)))];
}

/* ==========================================================================
   Match configuration
   ========================================================================== */

export type StageForm = "normal" | "battlefield" | "omega";

export const STAGE_FORMS: readonly StageForm[] = ["normal", "battlefield", "omega"];

export const STAGE_FORM_LABELS: Record<StageForm, string> = {
  normal: "Normal",
  battlefield: "Battlefield",
  omega: "Ω",
};

/** The real game cycles the form on press rather than opening a picker. */
export function nextStageForm(form: StageForm): StageForm {
  const i = STAGE_FORMS.indexOf(form);
  return STAGE_FORMS[(i + 1) % STAGE_FORMS.length];
}

export const RANDOM_STAGE = "random";
export const RANDOM_FIGHTER = "random";

export type PlayerKind = "human" | "cpu";

export interface PlayerSlot {
  readonly port: number;
  kind: PlayerKind;
  /** Ultimate's CPU levels run 1–9. */
  cpuLevel: number;
  /** `null` while the panel is empty; `RANDOM_FIGHTER` for the `?` pick. */
  fighterId: string | null;
  costume: number;
  /** Which control preset a human port is using. Ignored for CPUs. */
  scheme: SchemeId;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const MIN_STOCKS = 1;
export const MAX_STOCKS = 99;
export const MIN_CPU_LEVEL = 1;
export const MAX_CPU_LEVEL = 9;

/** Time is stored as frames because that is what the simulation counts. */
export const FRAMES_PER_SECOND = 60;
export const TIME_STEP_FRAMES = 30 * FRAMES_PER_SECOND;
export const MIN_TIME_FRAMES = 60 * FRAMES_PER_SECOND;
export const MAX_TIME_FRAMES = 99 * 60 * FRAMES_PER_SECOND;
export const DEFAULT_TIME_FRAMES = 150 * FRAMES_PER_SECOND;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function formatTime(frames: number): string {
  const totalSeconds = Math.round(frames / FRAMES_PER_SECOND);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface PlayerResultStat {
  readonly port: number;
  readonly kos: number;
  readonly falls: number;
  readonly sds: number;
}

export interface MatchResult {
  readonly kind: MatchOutcome["kind"];
  /** Ports in finishing order, winner first. */
  readonly placings: readonly number[];
  readonly stats: readonly PlayerResultStat[];
  /**
   * The fighter each port actually played, captured when the match started.
   * Without it, a random pick or a change of mind on the way back to the
   * results screen would relabel a match that has already been played.
   */
  readonly fighters: Readonly<Record<number, string>>;
}

export interface RebindResult {
  readonly ok: boolean;
  /** The port already holding the key, when the rebind was refused. */
  readonly conflictPort?: number;
  readonly conflictAction?: ControlAction;
}

interface MatchConfigState {
  rules: MatchRules;
  stageId: string;
  stageForm: StageForm;
  players: PlayerSlot[];
  bindings: Record<SchemeId, Bindings>;
  result: MatchResult | null;

  setMode(mode: MatchRules["mode"]): void;
  setStocks(stocks: number): void;
  setTimeLimit(frames: number): void;
  setSmashBall(on: boolean): void;

  setStage(id: string): void;
  setStageForm(form: StageForm): void;
  cycleStageForm(): void;

  addPlayer(): void;
  removePlayer(): void;
  setPlayerKind(port: number, kind: PlayerKind): void;
  togglePlayerKind(port: number): void;
  setCpuLevel(port: number, level: number): void;
  stepCpuLevel(port: number, delta: number): void;
  setFighter(port: number, fighterId: string | null): void;
  setCostume(port: number, costume: number): void;
  setScheme(port: number, scheme: SchemeId): boolean;

  rebind(scheme: SchemeId, action: ControlAction, code: string): RebindResult;
  resetBindings(scheme: SchemeId): void;

  setResult(result: MatchResult | null): void;
  reset(): void;
}

function makePlayer(port: number): PlayerSlot {
  return {
    port,
    // Ultimate opens on one human and a CPU opponent, which is also the only
    // configuration that is playable before anyone has visited /controls.
    kind: port === 0 ? "human" : "cpu",
    cpuLevel: 3,
    fighterId: null,
    costume: port,
    scheme: CONTROL_SCHEMES[Math.min(port, CONTROL_SCHEMES.length - 1)],
  };
}

function initialPlayers(): PlayerSlot[] {
  return [makePlayer(0), makePlayer(1)];
}

/**
 * Ultimate's 1v1 damage bonus is a property of the match, not a setting: it
 * applies exactly when two fighters are on the stage. Deriving it here rather
 * than exposing a toggle is the only way the rules panel can state the rule
 * truthfully — see SPEC §4.
 */
function withDerivedRules(rules: MatchRules, players: readonly PlayerSlot[]): MatchRules {
  const oneOnOne = players.length === 2;
  return oneOnOne === rules.oneOnOne ? rules : { ...rules, oneOnOne };
}

const INITIAL_RULES: MatchRules = {
  mode: "stock",
  stocks: 3,
  timeLimit: DEFAULT_TIME_FRAMES,
  smashBall: true,
  oneOnOne: true,
};

export const useMatchConfig = create<MatchConfigState>()((set, get) => ({
  rules: INITIAL_RULES,
  stageId: "battlefield",
  stageForm: "normal",
  players: initialPlayers(),
  bindings: {
    arrows: { ...DEFAULT_BINDINGS.arrows },
    mirrored: { ...DEFAULT_BINDINGS.mirrored },
    rightCluster: { ...DEFAULT_BINDINGS.rightCluster },
  },
  result: null,

  setMode: (mode) => set((s) => ({ rules: { ...s.rules, mode } })),

  setStocks: (stocks) =>
    set((s) => ({ rules: { ...s.rules, stocks: clamp(stocks, MIN_STOCKS, MAX_STOCKS) } })),

  setTimeLimit: (frames) =>
    set((s) => ({
      rules: { ...s.rules, timeLimit: clamp(frames, MIN_TIME_FRAMES, MAX_TIME_FRAMES) },
    })),

  setSmashBall: (smashBall) => set((s) => ({ rules: { ...s.rules, smashBall } })),

  setStage: (stageId) => set({ stageId }),
  setStageForm: (stageForm) => set({ stageForm }),
  cycleStageForm: () => set((s) => ({ stageForm: nextStageForm(s.stageForm) })),

  addPlayer: () =>
    set((s) => {
      if (s.players.length >= MAX_PLAYERS) return s;
      const players = [...s.players, makePlayer(s.players.length)];
      return { players, rules: withDerivedRules(s.rules, players) };
    }),

  removePlayer: () =>
    set((s) => {
      if (s.players.length <= MIN_PLAYERS) return s;
      const players = s.players.slice(0, -1);
      return { players, rules: withDerivedRules(s.rules, players) };
    }),

  setPlayerKind: (port, kind) =>
    set((s) => ({
      players: s.players.map((p) => (p.port === port ? { ...p, kind } : p)),
    })),

  togglePlayerKind: (port) =>
    set((s) => ({
      players: s.players.map((p) =>
        p.port === port ? { ...p, kind: p.kind === "cpu" ? "human" : "cpu" } : p,
      ),
    })),

  setCpuLevel: (port, level) =>
    set((s) => ({
      players: s.players.map((p) =>
        p.port === port ? { ...p, cpuLevel: clamp(level, MIN_CPU_LEVEL, MAX_CPU_LEVEL) } : p,
      ),
    })),

  stepCpuLevel: (port, delta) => {
    const player = get().players.find((p) => p.port === port);
    if (!player) return;
    get().setCpuLevel(port, player.cpuLevel + delta);
  },

  setFighter: (port, fighterId) =>
    set((s) => ({
      players: s.players.map((p) => (p.port === port ? { ...p, fighterId } : p)),
    })),

  setCostume: (port, costume) =>
    set((s) => ({
      players: s.players.map((p) => (p.port === port ? { ...p, costume } : p)),
    })),

  /**
   * Two humans on one keyboard may not share a preset — the presses would be
   * indistinguishable. Refusing here rather than in the UI means the rule
   * holds however the state is reached.
   */
  setScheme: (port, scheme) => {
    const taken = get().players.some(
      (p) => p.port !== port && p.kind === "human" && p.scheme === scheme,
    );
    if (taken) return false;
    set((s) => ({
      players: s.players.map((p) => (p.port === port ? { ...p, scheme } : p)),
    }));
    return true;
  },

  /**
   * Rebinding refuses a key another *active* human already holds, because a
   * `keydown` event carries no information about whose finger caused it — the
   * same reason Config 1 and Config 2 cannot be played simultaneously (SPEC
   * §6). Within one player a collision is a swap instead: the player asked for
   * this key here, and leaving the other action unbound would be a worse
   * answer than moving it.
   */
  rebind: (scheme, action, code) => {
    if (!code) return { ok: false };
    const { players, bindings } = get();

    for (const player of players) {
      if (player.kind !== "human" || player.scheme === scheme) continue;
      const theirs = bindings[player.scheme];
      const clash = CONTROL_ACTIONS.find((a) => theirs[a] === code);
      if (clash) return { ok: false, conflictPort: player.port, conflictAction: clash };
    }

    const current = bindings[scheme];
    const displaced = CONTROL_ACTIONS.find((a) => a !== action && current[a] === code);
    const next: Bindings = { ...current, [action]: code };
    if (displaced) next[displaced] = current[action];

    set({ bindings: { ...bindings, [scheme]: next } });
    return { ok: true };
  },

  resetBindings: (scheme) =>
    set((s) => ({ bindings: { ...s.bindings, [scheme]: { ...DEFAULT_BINDINGS[scheme] } } })),

  setResult: (result) => set({ result }),

  reset: () =>
    set({
      rules: INITIAL_RULES,
      stageId: "battlefield",
      stageForm: "normal",
      players: initialPlayers(),
      bindings: {
        arrows: { ...DEFAULT_BINDINGS.arrows },
        mirrored: { ...DEFAULT_BINDINGS.mirrored },
        rightCluster: { ...DEFAULT_BINDINGS.rightCluster },
      },
      result: null,
    }),
}));

/** Every panel filled is what unlocks READY TO FIGHT on the character select. */
export function allPortsReady(players: readonly PlayerSlot[]): boolean {
  return players.length >= MIN_PLAYERS && players.every((p) => p.fighterId !== null);
}

export const PORT_COLOURS = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)"] as const;
export const PORT_TAGS = ["P1", "P2", "P3", "P4"] as const;

export function portColour(port: number): string {
  return PORT_COLOURS[port % PORT_COLOURS.length];
}

export function portTag(port: number): string {
  return PORT_TAGS[port % PORT_TAGS.length];
}
