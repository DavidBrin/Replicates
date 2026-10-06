/**
 * Every duration and easing in SPEC §8's Motion list, in one table (§8).
 *
 * Every number here is **a recommendation** — the evidence is stills only —
 * so they live in one place rather than scattered through the components that
 * play them, and a retune is one diff.
 *
 * The queue is deliberately dumb: a list of `{ start, duration }` and a
 * `progress` function. The render loop already ticks on the session's dirty
 * flag (§10); animations only have to say whether anything is still moving.
 */

export const DURATION: { readonly [k: string]: number } = {
  // ---- turn and phase ----
  banner: 320,
  bannerHold: 1200,
  bannerOut: 240,
  phasePip: 220,
  phaseLabel: 160,
  troopsRing: 260,
  troopsRingTick: 500,

  // ---- camera ----
  cameraPan: 420,

  // ---- attack ----
  arrowDraw: 260,
  arrowHeadPop: 120,
  diceTumble: 900,
  diceStagger: 60,
  diceSettle: 140,
  /** Blitz shows at most `BLITZ_MAX_VISIBLE_ROUNDS` of these, then jumps to the result. */
  blitzRound: 90,
  troopTickMax: 600,
  troopTickPerUnit: 80,
  troopPulse: 180,
  damage: 700,

  // ---- capture ----
  captureWipe: 380,
  captureFlash: 180,
  continentGlow: 500,
  fortifyLoop: 900,

  // ---- cards ----
  cardAward: 520,
  cardToChip: 300,
  cardSelect: 160,
  cardDashLoop: 1200,
  cardsSeizedStagger: 80,
  cardsSeizedEach: 420,

  // ---- players and chat ----
  elimination: 400,
  balloonIn: 240,
  balloonHold: 3500,
  balloonOut: 200,
  botThinking: 1200,
  botThinkingStagger: 150,

  // ---- chrome ----
  modalIn: 180,
  modalOut: 140,
  amberBanner: 280,
  amberButtonStagger: 60,
  menuSelect: 200,
  menuCheckPop: 260,
  buttonPress: 90,

  // ---- victory and ambience ----
  victoryStars: 900,
  victoryStarStagger: 25,
  victorySpin: 8000,
  oceanDrift: 20000,
};

export const EASING: { readonly [k: string]: string } = {
  banner: "cubic-bezier(.16,1,.3,1)",
  camera: "cubic-bezier(.22,.61,.36,1)",
  backOut: "cubic-bezier(.34,1.56,.64,1)",
  easeOut: "ease-out",
  linear: "linear",
};

/** §8: "12 rounds visible maximum, then jump to the result". */
export const BLITZ_MAX_VISIBLE_ROUNDS = 12;
/** §8: the damage numeral's rise and its colour (not a token — it is the one red that is not `--danger`). */
export const DAMAGE_RISE_PX = -40;
export const DAMAGE_COLOUR = "#FF4D5F";
/** §8: the capture's white flash fires at 35% of the wipe. */
export const CAPTURE_FLASH_AT = 0.35;
/** §8: the troop tick pulses the disc to this scale. */
export const TROOP_PULSE_SCALE = 1.15;
/** §8: the continent glow runs 0 → 1 → 0.6. */
export const CONTINENT_GLOW_PEAK = 1;
export const CONTINENT_GLOW_REST = 0.6;

/** `min(600, 80·Δ)` ms (§8). */
export function troopTickDuration(delta: number): number {
  const steps = Math.abs(delta);
  return Math.min(DURATION.troopTickMax ?? 600, (DURATION.troopTickPerUnit ?? 80) * steps);
}

export type AnimKind =
  | "captureWipe"
  | "damage"
  | "diceTumble"
  | "troopTick"
  | "continentGlow"
  | "cardAward"
  | "cardsSeized"
  | "elimination"
  | "banner"
  | "balloon"
  | "victoryStars";

export interface Anim {
  readonly kind: AnimKind;
  readonly at?: readonly [number, number];
  readonly text?: string;
  readonly colour?: string;
  readonly start: number;
  readonly duration: number;
}

export interface AnimState {
  items: Anim[];
  skip: boolean;
}

/** The nominal duration of each kind, for a caller that does not want to look one up. */
export const KIND_DURATION: Readonly<Record<AnimKind, number>> = {
  captureWipe: 380,
  damage: 700,
  diceTumble: 900,
  troopTick: 600,
  continentGlow: 500,
  cardAward: 520,
  cardsSeized: 420,
  elimination: 400,
  banner: 320,
  balloon: 240,
  victoryStars: 900,
};

/**
 * `prefers-reduced-motion` **keeps** these as instant state changes — the
 * thing they animate still happens, it just happens at once (§8). The phase
 * pip is the third, but it is not a queued `Anim`.
 */
export const REDUCED_MOTION_KEPT: readonly AnimKind[] = ["captureWipe", "troopTick"];
/** …and **drops** these outright: nothing is shown at all (§8). */
export const REDUCED_MOTION_DROPPED: readonly AnimKind[] = ["diceTumble", "victoryStars"];

/**
 * The three durations `prefers-reduced-motion` keeps as instant state changes
 * (§8). Kept or dropped, the answer is the same number — zero; what differs is
 * whether the end state is applied, which `REDUCED_MOTION_KEPT` answers.
 * `globals.css` already carries the blanket override for everything else.
 */
export function reducedMotionDuration(kind: AnimKind): number {
  if (REDUCED_MOTION_DROPPED.includes(kind)) return 0; // never shown at all
  if (REDUCED_MOTION_KEPT.includes(kind)) return 0; // shown, but as an instant state change
  return 0; // everything else rides globals.css's blanket duration override
}

export function createAnimState(skip: boolean): AnimState {
  return { items: [], skip };
}

/** In skip mode the animation lands already finished, so the end state still applies. */
export function enqueue(state: AnimState, anim: Anim): void {
  state.items.push(state.skip ? { ...anim, duration: 0 } : anim);
}

/** Drop finished animations; returns true while anything is in flight. */
export function pruneAnims(state: AnimState, now: number): boolean {
  state.items = state.items.filter((anim) => now < anim.start + anim.duration);
  return state.items.length > 0;
}

/** 0..1 eased progress of one animation at `now`. */
export function progress(anim: Anim, now: number): number {
  if (anim.duration <= 0) return 1;
  const t = (now - anim.start) / anim.duration;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
