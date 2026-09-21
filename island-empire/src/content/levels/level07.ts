import { buildAsciiMap } from "./ascii";

/**
 * Level 07 — Mountain Pass. A mountain ridge runs across the island with
 * two narrow passes, both walled by red; a stone tower guards red's city
 * (the real level 7's tower line, `sheet-b01`). Blue owns the south with a
 * farm and room to grow — the puzzle is to out-earn red before forcing a
 * pass with a level 3 knight.
 */
export default buildAsciiMap({
  levelId: "07",
  name: "Mountain Pass",
  biome: "grass",
  players: [
    { kind: "human", startGold: 12 },
    { kind: "ai", startGold: 10 },
  ],
  terrain: `
    ~ ~ ~ . . . . . . ^ ^ ^ ^ ^
    ~ ~ . . . . . . . . . ^ ^ ^
    . . . . . . . . . . . . . .
    . . . T . . . . . . . . . .
    . . . . . . . . . . . f . .
    . . T T . . . . . . . . . .
    ^ ^ ^ ^ ^ . ^ ^ ^ ^ ^ . ^ ^
    ^ ^ ^ ^ ^ . ^ ^ ^ ^ ^ . ^ ^
    . . . . . . . . . . . . . .
    . . . . . . ~ ~ . . . . . .
    . . . . . . ~ ~ . . . T . .
    . . f . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . T T . . . . . . .
    . . . . . . . . . ^ ^ . . .
    . . . . . . . . . ^ ^ . . .
  `,
  owners: `
    . . . . . . . . . . . . . .
    . . . . . . 1 1 1 1 . . . .
    . . . . . . 1 1 1 1 . . . .
    . . . . . 1 1 1 1 1 1 1 . .
    . . . . . 1 . . . . . 1 . .
    . . . . . 1 . . . . . 1 . .
    . . . . . 1 . . . . . 1 . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . 0 0 0 0 0 . . . . . . . .
    . 0 0 0 0 0 . . . . . . . .
    . 0 0 0 0 0 . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
  `,
  objects: `
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . C . . . . . .
    . . . . . . . S . . . . . .
    . . . . . 1 . . . . . 1 . .
    . . . . . . . . . . . . . .
    . . . . . W . . . . . W . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . F . 1 . . . . . . . . .
    . . . C . . . . . . . . . .
    . . . 1 . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
  `,
  overlay: `
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . r r . r r r . . .
    . . . . . r . . . . r . . .
    . . . . . r . o . . . r . .
    . . . . . r . . . . . r . .
    . . . . . r . . . . . r . .
    . . . . . r . . . . . r . .
    . . . . . r . . . . . r . .
    . w . . . r . . . . . r . .
    . . . . . r . . . . . r . .
    . . . . r r . . . . . r . .
    . . . . . . . . o . . . . .
    . . . . . . . . . . . . w .
    . . . . . . . . . . . . . .
    . o . . . . . . . . . . . .
  `,
});
