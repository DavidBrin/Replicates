/**
 * Display names and blurbs for the eight bot personas — **ours, not SMG's**.
 *
 * SMG's own persona names (Aggressive, Continental, Stacker, Defensive, Friendly) are theirs and are
 * recorded in the spec as provenance only; what a player sees in our roster is this file. The engine
 * never imports it: `BotPersona.name` is the stable key ("rusher", "turtle", …) and this is the
 * presentation layer's lookup, so renaming a character cannot move a golden replay hash (D55).
 */

export interface PersonaDisplay {
  /** The roster name. */
  readonly name: string;
  /** One line for the tooltip, in the persona's own voice. */
  readonly blurb: string;
}

export const PERSONA_NAMES: Record<string, PersonaDisplay> = {
  rusher: {
    name: "Vanguard",
    blurb: "Takes every fight worth taking, and a few that aren't.",
  },
  continental: {
    name: "Cartographer",
    blurb: "Wants whole continents, and will wait a turn to get one.",
  },
  clusterer: {
    name: "Keystone",
    blurb: "Builds outward from one solid block and never leaves a gap.",
  },
  hoarder: {
    name: "Quartermaster",
    blurb: "Piles armies up and only moves when the answer is obvious.",
  },
  turtle: {
    name: "Bulwark",
    blurb: "One attack a turn, and only at very good odds.",
  },
  opportunist: {
    name: "Broker",
    blurb: "Friendly until your cards are worth taking.",
  },
  assassin: {
    name: "Headsman",
    blurb: "Keeps twenty on every border and hunts whoever is holding cards.",
  },
  wildcard: {
    name: "Understudy",
    blurb: "Plays someone else's game — you find out which one.",
  },
};

/** The roster name for a persona key, falling back to the key so the HUD never renders blank. */
export function personaDisplayName(key: string): string {
  return PERSONA_NAMES[key]?.name ?? key;
}

export function personaBlurb(key: string): string {
  return PERSONA_NAMES[key]?.blurb ?? "";
}
