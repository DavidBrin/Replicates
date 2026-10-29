/**
 * Which way each limb-bone move hits (Plan 4, Task 13 fix round 1), shared by
 * the two tests that judge where a limb box lands: the reach ratchet
 * (`reach.test.ts`), which measures how far a move reaches that way, and the
 * striking-limb test (`strike.test.ts`, Task 13b), which checks that the limb
 * carrying a box is the one leading that way.
 */

export type Dir = "F" | "B" | "U" | "D";
export type Klass = Dir | `SWEEP ${Dir}`;

/**
 * Each limb slot's direction class, from the move's published hit direction:
 * forward for jabs, tilts, forward airs, dash attacks and grabs; back for back
 * airs; up for up airs and up tilts; down for down airs; a sweep for a spin or
 * arc whose legacy box stands still (Samus's spinning neutral air, Pikachu's
 * drill). The neutral airs that are not spins are classed forward, as the
 * Task 13 review's per-frame survey classed them. Held slots are classed too,
 * so the slot is ready when its hold is lifted.
 */
export const DIRECTION: Readonly<Record<string, Klass>> = {
  "mario bair": "B",
  "mario dtilt": "F",
  "mario fair": "F",
  "mario ftilt": "F",
  "mario jab2": "F",
  "mario jab3": "F",
  "mario nair": "F",
  "mario uair": "U",
  "mario utilt": "U",
  "donkeyKong bair": "B",
  "donkeyKong fair": "F",
  "donkeyKong jab1": "F",
  "donkeyKong jab2": "F",
  "donkeyKong nair": "F",
  "link bair": "B",
  "link ftilt": "F",
  "link jab3": "F",
  "link nair": "F",
  "link utilt": "U",
  "samus bair": "B",
  "samus dair": "D",
  "samus dtilt": "F",
  "samus fair": "F",
  "samus ftilt": "F",
  "samus jab2": "F",
  "samus nair": "SWEEP F",
  "samus utilt": "U",
  "kirby dtilt": "F",
  "kirby ftilt": "F",
  "kirby nair": "F",
  "kirby uair": "U",
  "fox bair": "B",
  "fox dair": "D",
  "fox ftilt": "F",
  "fox nair": "F",
  "fox uair": "U",
  "pikachu bair": "B",
  "pikachu dair": "SWEEP D",
  "pikachu dashAttack": "F",
  "pikachu ftilt": "F",
  "pikachu uair": "U",
  "pikachu utilt": "U",
  "marth dair": "D",
  "marth dtilt": "F",
  "marth fair": "F",
  "marth ftilt": "F",
  "marth jab1": "F",
  "marth jab2": "F",
  "marth nair": "F",
  "marth uair": "U",
  "marth utilt": "U",
};

/** The direction a class hits in, its sweep stripped. */
export const dirOf = (k: Klass): Dir => (k.startsWith("SWEEP ") ? (k.slice(6) as Dir) : (k as Dir));

/** How far a point (x forward, y up, from the fighter's feet) lies along `d`. */
export const along = (d: Dir, x: number, y: number): number => (d === "F" ? x : d === "B" ? -x : d === "U" ? y : -y);
