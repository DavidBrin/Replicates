import { buildAsciiMap } from "./ascii";

/**
 * Level 06 — Riverlands. A river cross divides the island into four
 * quarters joined by four bridges (the real level 6's lake-and-bridge
 * motif, `sheet-b00`/`b01`). Blue in the south-west, red walled in the
 * north-east with two knights, green in the south-east; the north-west
 * quarter is empty land that blue and red both race for.
 */
export default buildAsciiMap({
  levelId: "06",
  name: "Riverlands",
  biome: "grass",
  players: [
    { kind: "human", startGold: 10 },
    { kind: "ai", startGold: 8 },
    { kind: "ai", startGold: 6 },
  ],
  terrain: `
    T T . . . . . ~ . . . . T T
    T . . . . . . ~ . . . . . T
    . . . . . . . ~ . . . . . .
    . . . . . . . = . . . . . .
    . . . T . . . ~ . . . . . .
    . . . . . . . ~ . . . ^ . .
    . . . . . . . ~ . . . ^ . .
    ~ ~ ~ = ~ ~ ~ ~ ~ ~ = ~ ~ ~
    . . . . . . . ~ . . . . . .
    . . . . . . . ~ . . . . . .
    . . T . . . . = . . . . . .
    . . . . . . . ~ . . . T . .
    . . . . . . . ~ . . . . . .
    . . . . . ^ . ~ . . . . . .
  `,
  owners: `
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . 1 1 1 . .
    . . . . . . . . . 1 1 1 . .
    . . . . . . . . . 1 1 1 . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . 0 0 0 . . . . . . . .
    . . . 0 0 0 . . 2 2 2 . . .
    . . 0 0 0 0 . . 2 2 2 . . .
    . . . . . . . . 2 2 2 . . .
    . . . . . . . . . . . . . .
  `,
  objects: `
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . W . 1 . .
    . . . . . . . . . . C . . .
    . . . . . . . . . 1 . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
    . . . . . 1 . . . . . . . .
    . . . . C . . . 1 . . . . .
    . . . F . . . . . C . . . .
    . . . . . . . . . . . . . .
    . . . . . . . . . . . . . .
  `,
  overlay: `
    . . . . . . . . . . . . . .
    . . w . . . . . . . . . p .
    . . . . . . . . . . . . . .
    . . . r r r r r r . . . . .
    . . . r . . . . . . . . . .
    . . . r . . . . . . o . . .
    . . . r . . . . . . r . . .
    . . . . . . . . . . . . . .
    . . . r . . . . . . r . . .
    . . . r r r r . . . r . . .
    . . . . . . r . r r r . . .
    . . . . . . . . . . . . . .
    . w . . . . . . . . . . o .
    . . . . . . . . . . . . . .
  `,
});
