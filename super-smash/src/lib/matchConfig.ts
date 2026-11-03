import { useEffect, useState } from "react";
import { create } from "zustand";

import { fx } from "@/engine/fixed";
import { CONTROL_STICK_JUMP_OFF } from "@/engine/types";
import { DEFAULT_PAD_SETTINGS, mappingFrom, type GamepadMapping, type PadSettings } from "@/input/gamepad";
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

/**
 * What a player binds, one key each, in the order `/controls` lists them.
 * `tilt` (Plan 5, Task 21b, ruling P5-R27) is held for a part-way push of the
 * stick, so a direction walks and Attack is never a smash (`Btn.Soft`; SPEC §6):
 * it sits with the directions it changes.
 */
export const CONTROL_ACTIONS = [
  "left",
  "right",
  "up",
  "down",
  "tilt",
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

/**
 * The Tilt keys `V`, `C` and `N` are each under a thumb, and held by no other
 * default binding here or in the input layer's presets (`input/schemes.ts`
 * says why each), so Configs 1 and 2 still share six keys and Config 3 none.
 */
export const DEFAULT_BINDINGS: Record<SchemeId, Bindings> = {
  arrows: {
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
    tilt: "KeyV",
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
    tilt: "KeyC",
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
    tilt: "KeyN",
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
  tilt: "Tilt",
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
  /** Plan 5: Ultimate's "Stick Jump" (tap jump) — up on the stick jumps. On by default. Ignored for CPUs. */
  stickJump: boolean;
  /**
   * Plan 5: this player's gamepad buttons and right stick. Read on this
   * machine only: what travels online is the packed frame.
   */
  pad: PadSettings;
}

/** A player's own control options (Plan 5): what `/controls` sets per port, and what an online session must not overwrite. */
export type ControlOptions = Pick<PlayerSlot, "stickJump" | "pad">;

/** A port's options with nothing chosen, and each field's default for a bad saved one (`controlPrefs.ts`). */
export const DEFAULT_CONTROL_OPTIONS: ControlOptions = { stickJump: true, pad: DEFAULT_PAD_SETTINGS };

/** `slot` with `options` (or as it is, with none), field by field: a saved entry never brings anything else along. */
function withOptions(slot: PlayerSlot, options: ControlOptions | undefined): PlayerSlot {
  return options === undefined ? slot : { ...slot, stickJump: options.stickJump, pad: options.pad };
}

/** The gamepad mapping for a slot's pad settings (Plan 5). */
export function padMappingOf(slot: Pick<PlayerSlot, "pad">): GamepadMapping {
  return mappingFrom(slot.pad);
}

/** A slot's control options as the simulation's `CONTROL_*` bits (Plan 5). A CPU plays the default. */
export function controlsOf(slot: Pick<PlayerSlot, "kind" | "stickJump">): number {
  return slot.kind === "human" && !slot.stickJump ? CONTROL_STICK_JUMP_OFF : 0;
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

/**
 * A set of rules in one line, as the results screen states them and the
 * guest's character select shows the host's: "3-stock match · 1v1 damage
 * 1.2× · Smash Ball off". One wording, so the two can never disagree.
 */
export function rulesLabel(rules: MatchRules): string {
  const length = rules.mode === "stock" ? `${rules.stocks}-stock` : "Timed";
  return `${length} match${rules.oneOnOne ? " · 1v1 damage 1.2×" : ""}${rules.smashBall ? " · Smash Ball on" : " · Smash Ball off"}`;
}

/**
 * The rules in a few words, for a narrow screen's banner (Plan 6, Task 28): "3 stocks", "1 stock",
 * or a timed match's length as the match clock shows it, "2:30".
 */
export function shortRulesLabel(rules: MatchRules): string {
  if (rules.mode === "stock") return `${rules.stocks} ${rules.stocks === 1 ? "stock" : "stocks"}`;
  return formatTime(rules.timeLimit);
}

export interface PlayerResultStat {
  readonly port: number;
  readonly kos: number;
  readonly falls: number;
  readonly sds: number;
}

export interface MatchResult {
  /**
   * How the match ended — or that it could not finish online: the connection
   * was lost, or the two machines' confirmed states disagreed (a desync).
   */
  readonly kind: MatchOutcome["kind"] | "connectionLost" | "desync";
  /** Ports in finishing order, winner first. Empty when the match could not finish. */
  readonly placings: readonly number[];
  readonly stats: readonly PlayerResultStat[];
  /**
   * The fighter each port actually played, captured when the match started.
   * Without it, a random pick or a change of mind on the way back to the
   * results screen would relabel a match that has already been played.
   */
  readonly fighters: Readonly<Record<number, string>>;
  /**
   * The rules the match was played under. Online that is the host's set,
   * which the guest's own config never holds; absent, the screen falls back
   * to this machine's rules.
   */
  readonly rules?: MatchRules;
  /** Played online: no local rematch, and quitting leaves the room. */
  readonly online?: boolean;
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
  /** Seated for an online match by `configureOnline`, until `leaveOnline` or `reset`. */
  online: boolean;
  /**
   * Plan 5: this machine's player's control options through an online session:
   * taken from the offline seats by `configureOnline`, changed only by this
   * machine's own edits (`setLocalStickJump`, `setLocalPad`) and the load
   * (`applyControlPrefs`), never by the other player's pick, and seated again
   * by `leaveOnline` (rulings P5-R26, R-T20a). Meaningful only while `online`:
   * offline the seats hold the options, and this is what the last session or
   * load left, unread.
   */
  localOptions: ControlOptions;
  /**
   * Plan 5: each port's control options as kept between visits
   * (`lib/controlPrefs.ts`): what `applyControlPrefs` loaded, with every
   * `/controls` edit since. Only those setters and the load change it: never
   * the other player's pick, an online session's seating, or adding or
   * dropping a player (ruling P5-R26). `ControlPrefsSync` saves it whenever it
   * changes, and a seat added or seated again takes its port's entry.
   */
  controlPrefs: ControlPrefs;

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
  /** Plan 5: turn a port's stick jump on or off, on `/controls`; kept (`controlPrefs`). */
  setStickJump(port: number, on: boolean): void;
  /**
   * Plan 5: the other peer's Stick Jump, from their pick (P5-R25). Theirs, not
   * this machine's: their port's seat alone, never kept (P5-R26).
   */
  setPeerStickJump(port: number, on: boolean): void;
  /** Plan 5: a port's gamepad buttons and right stick, on `/controls`; kept (`controlPrefs`). */
  setPad(port: number, pad: PadSettings): void;
  /**
   * Plan 5 (ruling R-T20a): this machine's own port's stick jump during an online
   * session, kept for after it (`localOptions`). `onlineStore.setOwnStickJump`,
   * which knows the port, calls it; the other player's pick never does.
   */
  setLocalStickJump(port: number, on: boolean): void;
  /** Plan 5: this machine's own port's pad settings during an online session, as `setLocalStickJump` (`onlineStore.setOwnPad`). */
  setLocalPad(port: number, pad: PadSettings): void;
  /**
   * Plan 5: each port's saved Stick Jump and pad settings (`ControlPrefsSync`).
   * Offline they take their seats, and this machine's options follow its
   * first human's. During an online session the seats are the session's:
   * only this machine's options take port 0's, for `leaveOnline` to seat.
   */
  applyControlPrefs(prefs: ControlPrefs): void;
  /** Two humans, one per machine, each on their own keyboard's Config 1, both with this machine's control options. */
  configureOnline(): void;
  /** Back to the offline default: one human, with this machine's control options again, and a CPU. */
  leaveOnline(): void;

  rebind(scheme: SchemeId, action: ControlAction, code: string): RebindResult;
  resetBindings(scheme: SchemeId): void;

  setResult(result: MatchResult | null): void;
  reset(): void;
}

/** Each port's kept control options (Plan 5); a port with none is absent. */
export type ControlPrefs = Partial<Record<number, ControlOptions>>;

/**
 * Where this machine's player's options are kept while an online session
 * holds them: port 0, where `leaveOnline` seats them again, so a reload
 * brings back what leaving did.
 */
const LOCAL_PREFS_PORT = 0;

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
    ...DEFAULT_CONTROL_OPTIONS,
  };
}

/** One human, with `local`'s control options, and a CPU with its port's kept ones (`saved`). */
function initialPlayers(local: ControlOptions = DEFAULT_CONTROL_OPTIONS, saved: ControlPrefs = {}): PlayerSlot[] {
  return [withOptions(makePlayer(0), local), withOptions(makePlayer(1), saved[1])];
}

/**
 * An online port. Both start with this machine's player's control options —
 * the local port keeps them, and the remote one's Stick Jump is overwritten by
 * the other peer's pick (`onlineStore`). The remote one's pad settings are
 * never read here: the other peer's pad is on their machine.
 */
function onlinePlayer(port: number, local: ControlOptions): PlayerSlot {
  return { port, kind: "human", cpuLevel: 3, fighterId: null, costume: port, scheme: "arrows", stickJump: local.stickJump, pad: local.pad };
}

/**
 * This machine's player's control options: those its online session seated, or
 * offline, its first human's (or port 0's, with none).
 */
function localOptionsOf(s: Pick<MatchConfigState, "online" | "localOptions" | "players">): ControlOptions {
  if (s.online) return s.localOptions;
  const local = s.players.find((p) => p.kind === "human") ?? s.players[0];
  return local === undefined ? DEFAULT_CONTROL_OPTIONS : { stickJump: local.stickJump, pad: local.pad };
}

/** A `/controls` edit to `port`'s seat (Plan 5): the seat changes, and so does what is kept for the port. */
function editSeat(s: MatchConfigState, port: number, edit: Partial<ControlOptions>): Partial<MatchConfigState> {
  const seat = s.players.find((p) => p.port === port);
  if (seat === undefined) return {};
  const options: ControlOptions = { stickJump: seat.stickJump, pad: seat.pad, ...edit };
  return {
    players: s.players.map((p) => (p === seat ? withOptions(p, options) : p)),
    controlPrefs: { ...s.controlPrefs, [port]: options },
  };
}

/**
 * This machine's own edit during an online session (R-T20a): its own seat,
 * its options for after the session (`localOptions`), and what is kept for
 * them, under `LOCAL_PREFS_PORT`.
 */
function editLocal(s: MatchConfigState, port: number, edit: Partial<ControlOptions>): Partial<MatchConfigState> {
  const localOptions: ControlOptions = { ...s.localOptions, ...edit };
  return {
    players: s.players.map((p) => (p.port === port ? withOptions(p, { stickJump: p.stickJump, pad: p.pad, ...edit }) : p)),
    localOptions,
    controlPrefs: { ...s.controlPrefs, [LOCAL_PREFS_PORT]: localOptions },
  };
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

/**
 * Every preset's default keys, each its own copy: what a page starts with and
 * `reset` restores. Keys are never saved between visits (only Stick Jump and
 * the pad are, `lib/controlPrefs.ts`), so this is also what every visit loads,
 * the Tilt key included (Plan 5, Task 21b).
 */
function defaultBindings(): Record<SchemeId, Bindings> {
  return {
    arrows: { ...DEFAULT_BINDINGS.arrows },
    mirrored: { ...DEFAULT_BINDINGS.mirrored },
    rightCluster: { ...DEFAULT_BINDINGS.rightCluster },
  };
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
  bindings: defaultBindings(),
  result: null,
  online: false,
  localOptions: DEFAULT_CONTROL_OPTIONS,
  controlPrefs: {},

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
      const port = s.players.length;
      const players = [...s.players, withOptions(makePlayer(port), s.controlPrefs[port])];
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

  setStickJump: (port, on) => set((s) => editSeat(s, port, { stickJump: on })),

  setPeerStickJump: (port, on) =>
    set((s) => ({ players: s.players.map((p) => (p.port === port ? { ...p, stickJump: on } : p)) })),

  setPad: (port, pad) => set((s) => editSeat(s, port, { pad })),

  setLocalStickJump: (port, on) => set((s) => editLocal(s, port, { stickJump: on })),

  setLocalPad: (port, pad) => set((s) => editLocal(s, port, { pad })),

  applyControlPrefs: (prefs) =>
    set((s) => {
      const controlPrefs = { ...prefs };
      if (s.online) return { controlPrefs, localOptions: prefs[LOCAL_PREFS_PORT] ?? s.localOptions };
      const players = s.players.map((p) => withOptions(p, prefs[p.port]));
      return { players, controlPrefs, localOptions: localOptionsOf({ ...s, players }) };
    }),

  configureOnline: () =>
    set((s) => {
      const local = localOptionsOf(s);
      const players = [onlinePlayer(0, local), onlinePlayer(1, local)];
      return { players, rules: withDerivedRules(s.rules, players), result: null, online: true, localOptions: local };
    }),

  // `result` is kept: the results screen calls this on its way out, and
  // clearing it there would flash "No match yet" before the navigation lands.
  // The local player's control options come back with the seat (P5-R26): the
  // session, and the other player's pick, never change them. The CPU's seat
  // takes its port's kept options, as a seat added does.
  // R-T21c (accepted): port 0 gets the offline first human's options; with that human off port 0, a reload seats port 0's own.
  leaveOnline: () =>
    set((s) => {
      const local = localOptionsOf(s);
      const players = initialPlayers(local, s.controlPrefs);
      return { players, rules: withDerivedRules(s.rules, players), online: false, localOptions: local };
    }),

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
      bindings: defaultBindings(),
      result: null,
      online: false,
      localOptions: DEFAULT_CONTROL_OPTIONS,
      controlPrefs: {},
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
