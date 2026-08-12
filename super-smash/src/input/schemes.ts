/**
 * Keyboard presets, and the collision analysis that decides which of them may
 * be live at the same time.
 *
 * Every binding is a `KeyboardEvent.code`, never a `.key`. `code` names the
 * *physical* key by its position on a US-QWERTY reference board, so the key one
 * row up and one to the left of `Enter` is `BracketRight` whether the player is
 * on QWERTY, AZERTY, QWERTZ or Dvorak. Binding on `.key` would put Config 2's
 * "A = left" under the physical `Q` on a French keyboard, and the player would
 * have no way to discover why. See SPEC §6.
 */

import { Btn } from "@/engine/types";

/* ----------------------------------------------------------------- actions -- */

/** The nine things a player can ask a fighter to do. One bit each. */
export type GameAction =
  | "left"
  | "right"
  | "up"
  | "down"
  | "attack"
  | "special"
  | "shield"
  | "jump"
  | "grab";

/** Stable order, so UI lists and conflict reports are deterministic. */
export const GAME_ACTIONS: readonly GameAction[] = [
  "left",
  "right",
  "up",
  "down",
  "attack",
  "special",
  "shield",
  "jump",
  "grab",
];

/** Which bit of an `InputFrame` each action sets. */
export const ACTION_BUTTON: Readonly<Record<GameAction, Btn>> = {
  left: Btn.Left,
  right: Btn.Right,
  up: Btn.Up,
  down: Btn.Down,
  attack: Btn.Attack,
  special: Btn.Special,
  shield: Btn.Shield,
  jump: Btn.Jump,
  grab: Btn.Grab,
};

export type Bindings = Readonly<Record<GameAction, string>>;

export interface Scheme {
  readonly id: string;
  /** Shown on `/controls`. */
  readonly name: string;
  readonly blurb: string;
  readonly bindings: Bindings;
}

/* ----------------------------------------------------------------- presets -- */

/**
 * Config 1 — "Arrows".
 *
 * Right hand steers on the arrow cluster, left hand acts on `Q W E` / `A D`.
 * The action cluster is a deliberate shape: three keys on the top row and two
 * on the home row with a gap between them, so the resting hand finds jump
 * (middle finger, `W`) and attack (index, `D`) without looking.
 */
export const CONFIG_ARROWS: Scheme = {
  id: "arrows",
  name: "Arrows",
  blurb: "Steer with the arrow keys, act with Q W E / A D.",
  bindings: {
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
    special: "KeyA",
    attack: "KeyD",
    grab: "KeyQ",
    shield: "KeyE",
    jump: "KeyW",
  },
};

/**
 * Config 2 — "WASD (mirrored)".
 *
 * The same layout reflected: left hand steers on `W A S D`, right hand acts on
 * the arrows plus `ShiftLeft` and `Slash`. For a player who already thinks in
 * WASD this is the natural preset; it is not a second player's preset, for the
 * reason set out under `detectConflicts` below.
 */
export const CONFIG_WASD: Scheme = {
  id: "wasd",
  name: "WASD (mirrored)",
  blurb: "Steer with W A S D, act with the arrows, Shift and /.",
  bindings: {
    left: "KeyA",
    right: "KeyD",
    up: "KeyW",
    down: "KeyS",
    special: "ArrowLeft",
    attack: "ArrowRight",
    jump: "ArrowUp",
    shield: "ShiftLeft",
    grab: "Slash",
  },
};

/**
 * Config 3 — "Local P2". The cluster a second player uses on the same laptop.
 *
 * Constraints this had to satisfy, in the order they mattered:
 *
 *  1. **Disjoint from both presets above.** Configs 1 and 2 between them claim
 *     `ArrowLeft/Right/Up/Down`, `KeyQ W E A S D`, `ShiftLeft` and `Slash`.
 *     Config 3 touches none of them, so it can be paired with *either* one
 *     without a single ambiguous key — which is the whole point of its
 *     existing.
 *  2. **No modifier anchors.** `Shift`, `Control`, `Alt` and `Meta` are the
 *     classic ghosting anchors on a membrane board: they sit alone on their
 *     matrix line and are wired to be readable during any combination, which is
 *     exactly why holding one *plus* two ordinary keys is where cheap keyboards
 *     start dropping the third. They also carry OS-level meaning that a web
 *     page cannot suppress (Sticky Keys, Alt focusing the menu bar, Meta
 *     opening the launcher). A held shield key is the longest-held key in the
 *     game, so it is the worst possible candidate for a modifier.
 *  3. **Movement and actions in different regions of the matrix.** Movement is
 *     the left-centre inverted-T `T F G H`; actions are the right-centre
 *     `U I O` / `J L`. A fighter running and attacking presses one key from
 *     each region simultaneously, and keys that far apart are on different
 *     matrix columns, so the pair cannot form the two corners of a phantom-key
 *     rectangle with a third key. Cramming all nine into one 3x3 block is what
 *     produces "I can't shield while running left".
 *  4. **Nothing the browser or the OS owns.** No `Space` (scrolls the page and
 *     activates the focused control), no `Enter`, no `Tab` (moves focus out of
 *     the canvas), no `Escape` (leaves fullscreen, and `preventDefault` on it
 *     is ignored by design), no `Backspace`, no numpad — a laptop has none.
 *
 * The action cluster repeats Config 1's shape one hand to the right: three on
 * the top row (`U I O` = grab, jump, shield) and two on the home row with a gap
 * (`J _ L` = special, attack), so a player who has learned either preset can
 * read this one off muscle memory.
 */
export const CONFIG_LOCAL_P2: Scheme = {
  id: "localP2",
  name: "Local P2",
  blurb: "The second seat: steer with T F G H, act with U I O / J L.",
  bindings: {
    up: "KeyT",
    left: "KeyF",
    down: "KeyG",
    right: "KeyH",
    grab: "KeyU",
    jump: "KeyI",
    shield: "KeyO",
    special: "KeyJ",
    attack: "KeyL",
  },
};

/** Every preset, in the order `/controls` lists them. */
export const SCHEMES: readonly Scheme[] = [CONFIG_ARROWS, CONFIG_WASD, CONFIG_LOCAL_P2];

export function schemeById(id: string): Scheme | undefined {
  return SCHEMES.find((s) => s.id === id);
}

/* --------------------------------------------------------------- conflicts -- */

export interface ConflictClaim {
  readonly schemeId: string;
  readonly action: GameAction;
}

export interface Conflict {
  /** The physical key, as a `KeyboardEvent.code`. */
  readonly code: string;
  /** Every claim on it, in scheme order then action order. */
  readonly claims: readonly ConflictClaim[];
}

/**
 * Every physical key claimed more than once across the given schemes.
 *
 * **Configs 1 and 2 collide on exactly six keys, and that is a property of the
 * layouts rather than a bug.** They are mirror images of each other, so
 * `KeyW`, `KeyA`, `KeyD`, `ArrowUp`, `ArrowLeft` and `ArrowRight` each carry
 * opposite meanings between them — `KeyW` is Config 1's jump and Config 2's
 * up; `ArrowLeft` is Config 1's left and Config 2's special. A `keydown` event
 * reports a key, not a finger, so with both live there is no information
 * anywhere in the browser that could tell the two players apart. Nothing can
 * fix that except changing one of the layouts, which would stop it being "the
 * same but mirrored".
 *
 * So they are *alternative presets a player chooses*, they are never both
 * active, and two people on one laptop use Config 3 for the second seat. This
 * function is what enforces that: it is called before any scheme is activated
 * and before any rebind is accepted.
 *
 * Self-collisions count too — a scheme that has been rebound so two actions
 * share one key is reported with both claims naming the same scheme.
 */
export function detectConflicts(schemes: readonly Scheme[]): Conflict[] {
  const claims = new Map<string, ConflictClaim[]>();

  for (const scheme of schemes) {
    for (const action of GAME_ACTIONS) {
      const code = scheme.bindings[action];
      const list = claims.get(code);
      if (list) list.push({ schemeId: scheme.id, action });
      else claims.set(code, [{ schemeId: scheme.id, action }]);
    }
  }

  const conflicts: Conflict[] = [];
  for (const [code, list] of claims) {
    if (list.length > 1) conflicts.push({ code, claims: list });
  }
  // Sorted so the UI and the tests see a stable order regardless of Map
  // insertion order.
  conflicts.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return conflicts;
}

/** True when the two schemes share at least one physical key. */
export function schemesConflict(a: Scheme, b: Scheme): boolean {
  const codes = new Set(GAME_ACTIONS.map((action) => a.bindings[action]));
  return GAME_ACTIONS.some((action) => codes.has(b.bindings[action]));
}

/** Every physical key a scheme claims. */
export function schemeCodes(scheme: Scheme): string[] {
  return GAME_ACTIONS.map((action) => scheme.bindings[action]);
}

export class SchemeConflictError extends Error {
  readonly conflicts: readonly Conflict[];

  constructor(conflicts: readonly Conflict[]) {
    const summary = conflicts
      .map((c) => `${c.code} (${c.claims.map((x) => `${x.schemeId}.${x.action}`).join(" / ")})`)
      .join(", ");
    super(
      `These control schemes cannot be active together: they share ${conflicts.length} ` +
        `physical key${conflicts.length === 1 ? "" : "s"} — ${summary}. ` +
        `Configs 1 and 2 are mirror images and always collide; use "${CONFIG_LOCAL_P2.name}" ` +
        `for a second player on the same keyboard.`,
    );
    this.name = "SchemeConflictError";
    this.conflicts = conflicts;
  }
}

/**
 * The gate. Throws rather than returning a flag, because the failure mode this
 * prevents — two players silently driving one fighter — is not something a
 * caller should be able to ignore by forgetting to check a boolean.
 */
export function assertSchemesCompatible(schemes: readonly Scheme[]): void {
  const conflicts = detectConflicts(schemes);
  if (conflicts.length > 0) throw new SchemeConflictError(conflicts);
}

export interface Selection {
  readonly active: readonly Scheme[];
  readonly rejected: readonly { readonly scheme: Scheme; readonly conflicts: readonly Conflict[] }[];
}

/**
 * Resolve a wish-list of schemes into a set that can actually run together,
 * earlier entries winning. The player-select screen uses this so that picking
 * "Arrows" for P1 visibly greys "WASD" out for P2 instead of letting them pick
 * it and discover the problem mid-match.
 */
export function conflictFreeSelection(requested: readonly Scheme[]): Selection {
  const active: Scheme[] = [];
  const rejected: { scheme: Scheme; conflicts: Conflict[] }[] = [];

  for (const scheme of requested) {
    const conflicts = detectConflicts([...active, scheme]);
    if (conflicts.length === 0) active.push(scheme);
    else rejected.push({ scheme, conflicts });
  }

  return { active, rejected };
}

/** True when `code` is free for `scheme` to claim, given everything else live. */
export function isCodeAvailable(code: string, others: readonly Scheme[]): boolean {
  return !others.some((s) => schemeCodes(s).includes(code));
}

/**
 * Rebind one action, refusing a key another live scheme already holds — the
 * behaviour SPEC §6 requires of the binding UI. Returns a new scheme; schemes
 * are immutable so a half-applied rebind cannot exist.
 */
export function rebind(
  scheme: Scheme,
  action: GameAction,
  code: string,
  others: readonly Scheme[] = [],
): Scheme {
  const next: Scheme = {
    ...scheme,
    bindings: { ...scheme.bindings, [action]: code },
  };
  assertSchemesCompatible([...others.filter((s) => s.id !== scheme.id), next]);
  return next;
}
