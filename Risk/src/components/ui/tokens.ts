/**
 * The handful of §7/§8 measured values that `globals.css` does not (yet) carry
 * as a custom property.
 *
 * `globals.css` is the only place a colour hex may live (SPEC §8, F8) and no
 * component here hard-codes one: everything that *has* a token references it
 * as `var(--token)`. The SPEC, however, quotes a few screen-specific values
 * that the scaffold's token sheet never declared — the segmented-toggle track,
 * the menu-card description grey, the count-slider numeral grey, and so on.
 * Rather than scatter those literals across nine components, they live here
 * once, named, with the SPEC line that measured them. The day they move into
 * `globals.css` this module becomes nine `var(...)` strings and then nothing.
 *
 * Nothing in here is a *player* or *board* colour — those are all tokens.
 */
export const SETUP_TOKENS = {
  /** §7 `/new` footer: the segmented `FFA | 1v1` track. */
  segmentTrack: "#242424",
  /** §7 `/new`: game-type card description copy. */
  cardDescription: "#E2EAEE",
  /** §7.2 count slider: the unselected numerals, before the distance fade. */
  sliderNumeral: "#C9CFD2",
  /** §7.2 count slider: the full-width strip behind it. */
  sliderStrip: "rgba(10,45,55,.55)",
  /** §7 `/new/rules`: a modifier toggle's label while the modifier is off. */
  modifierOffLabel: "#6E7F88",
  /** §7 `/new/rules`: the rules-readout values. */
  readoutValue: "#CBD6DB",
  /** §7 `/new/map`: the ray-burst backdrop fades to this. */
  mapBackdrop: "#0E2430",
  /** §7 `/new/rules`: the red mode plate gradient (top is `--danger`). */
  modePlateBottom: "#A3203A",
  /** §7 `/new/map` mini board: land parchment, coasts, internal borders. */
  tileLand: "#F3DCC0",
  tileCoast: "#B8894A",
  tileBorder: "#9AA0A4",
} as const;
