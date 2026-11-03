/**
 * How far each fighter's whole pose is raised so its idle stance stands on the floor
 * (Plan 6, Task 19; Plan 4 Task 17's review: "at idle feet/hands sink up to 1.1 below
 * the floor (Mario −1.11, DK knuckles −1.07, Kirby −0.57)"). World units, read by
 * `rootXformInto`, so the bake (the sim's bones, its hurtboxes and its ECB's top) and the
 * drawing rise together.
 *
 * Decided on the hurtboxes (ruling D13): a lift is the leg hurtboxes' sink at idle (the
 * committed bake, the lowest leg capsule over the idle cycle, which `stance.test.ts`
 * measures), capped by the drawn feet's (`stance.probe.test.ts`, on the local models), so
 * it floats neither a hurtbox nor the drawing off the floor.
 * - Kirby: legs 2.57 under, mesh 0.57 under → 0.57. His leg capsules stay 2.0 under the
 *   floor, where nothing reaches.
 * Not lifted (D59 records each):
 * - Mario: legs 0.32 under, mesh 1.23 (the probe, Task 19). A 0.32 lift leaves his soles 0.91
 *   under (his shoes reach below his leg capsules) and draws Donkey Kong and Fox inside him in
 *   their Final Smash scenes (R-T17i, `sceneDraw.test.ts`): their scene gaps re-measured across
 *   17 pins, for a quarter of his sink. Carried, with the retarget's foot fit.
 * - Donkey Kong: his legs stand 0.18 above the floor; his sink is his knuckles' (1.02: his
 *   idle rests on them), the idle clip's arm length, not a lift.
 * - Link, Marth and Samus: their lowest idle hurtboxes are above the floor already.
 * UNVERIFIED (cosmetic, and it moves the hurtboxes): one lift for every motion, the idle's.
 */
export const STANCE_UP: Readonly<Record<string, number>> = {
  kirby: 0.57,
  // Carried, not lifted (Task 19's probe): Pikachu (legs 1.234 under, mesh 1.25) and Fox (legs
  // 0.120, mesh 0.34). Lifting their bodies turned 12 close-range jabs, dtilts and dsmashes on
  // them into whiffs (`stance.test.ts`'s Review Focus sweep), so the fix is their idle clips'
  // feet, a clip-authoring item for a later plan.
};

/** Fighters lifted by their mesh's sink, smaller than their hurtboxes': their lowest idle hurtbox stays under the floor. */
export const MESH_CAPPED: ReadonlySet<string> = new Set(["kirby"]);
