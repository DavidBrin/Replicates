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
 * so the slot is ready when its hold is lifted. Plan 5 Task 7's throws and
 * pummel by where their boxes hit before the launch: Mario's back-throw hip
 * box and Link's back-throw kicks behind him, Link's forward-throw kicks
 * ahead, his up-throw sword above, Pikachu's down-throw hip press below, his
 * pummel ahead. Plan 5 Task 13's smashes and Spin Attack (ruling P5-R17):
 * forward smashes forward, up smashes up, and the down smashes and Spin Attack,
 * which hit in front and behind, a forward sweep. Plan 5 Task 13b's: Link's aerial
 * Spin Attack, front and back hits, a forward sweep.
 */
export const DIRECTION: Readonly<Record<string, Klass>> = {
  "mario bair": "B",
  "mario bthrow": "B",
  "mario dtilt": "F",
  "mario fair": "F",
  "mario fsmash": "F",
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
  "link bthrow": "B",
  "link dsmash": "SWEEP F",
  "link fthrow": "F",
  "link ftilt": "F",
  "link jab3": "F",
  "link nair": "F",
  "link upB": "SWEEP F",
  "link upBAir": "SWEEP F",
  "link uthrow": "U",
  "link utilt": "U",
  "samus bair": "B",
  "samus dair": "D",
  "samus dsmash": "SWEEP F",
  "samus dtilt": "F",
  "samus fair": "F",
  "samus fsmash": "F",
  "samus ftilt": "F",
  "samus jab2": "F",
  "samus nair": "SWEEP F",
  "samus utilt": "U",
  "kirby dtilt": "F",
  "kirby fsmash": "F",
  "kirby ftilt": "F",
  "kirby nair": "F",
  "kirby uair": "U",
  "fox bair": "B",
  "fox dair": "D",
  "fox fsmash": "F",
  "fox ftilt": "F",
  "fox nair": "F",
  "fox uair": "U",
  "fox usmash": "U",
  "pikachu bair": "B",
  "pikachu dair": "SWEEP D",
  "pikachu dashAttack": "F",
  "pikachu dthrow": "D",
  "pikachu ftilt": "F",
  "pikachu pummel": "F",
  "pikachu uair": "U",
  "pikachu usmash": "U",
  "pikachu utilt": "U",
  "marth dair": "D",
  "marth dsmash": "SWEEP F",
  "marth dtilt": "F",
  "marth fair": "F",
  "marth fsmash": "F",
  "marth ftilt": "F",
  "marth jab1": "F",
  "marth jab2": "F",
  "marth nair": "F",
  "marth uair": "U",
  "marth usmash": "U",
  "marth utilt": "U",
};

/** The direction a class hits in, its sweep stripped. */
export const dirOf = (k: Klass): Dir => (k.startsWith("SWEEP ") ? (k.slice(6) as Dir) : (k as Dir));

/** How far a point (x forward, y up, from the fighter's feet) lies along `d`. */
export const along = (d: Dir, x: number, y: number): number => (d === "F" ? x : d === "B" ? -x : d === "U" ? y : -y);
