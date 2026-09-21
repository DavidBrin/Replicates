import { buildAsciiMap } from "./ascii";

/**
 * Level 05 — Across the Bridge. Mirrors the real level 5 (`sheet-b00`,
 * wt-0330..0420): a river across the south with one bridge, blue holding a
 * province on each bank (each with its own treasury), red walled up in the
 * north-east with three woodwalls, and — the first three-player map — a
 * green kingdom in the west.
 */
export default buildAsciiMap({
  levelId: "05",
  name: "Across the Bridge",
  biome: "grass",
  players: [
    { kind: "human", startGold: 10 },
    { kind: "ai", startGold: 8 },
    { kind: "ai", startGold: 6 },
  ],
  terrain: `
    T T . . . . . T T T T T
    T . . . . . . . . . . T
    . . . . T . . . . . . .
    . . . . . . . . . . . .
    . . T . . . . . . T T .
    . . . . . . . . . . . .
    ^ ^ . . . . . . . T T .
    ^ ^ . . . . . . . . . .
    . . . . . . . . . . . .
    ~ ~ ~ ~ ~ = ~ ~ ~ ~ ~ ~
    . . . . . . . . . . . .
    . . . . . . . . . T . .
    . . . T . . . . . . . .
    . . . . . . . . . . . .
  `,
  owners: `
    . . . . . . . . . . . .
    . . . . . . . 1 1 1 1 .
    2 2 2 . . . . 1 1 1 1 .
    2 2 2 . . . . . 1 1 1 .
    2 2 . . . . . . . . . .
    . 2 . . . . . . . . . .
    . . . . . 0 . . . . . .
    . . . . 0 0 0 . . . . .
    . . . . 0 0 0 . . . . .
    . . . . . . . . . . . .
    . . . . 0 0 0 . . . . .
    . . . . 0 0 0 . . . . .
    . . . . . 0 . . . . . .
    . . . . . . . . . . . .
  `,
  objects: `
    . . . . . . . . . . . .
    . . . . . . . . . C . .
    . . 1 . . . . W . . . .
    . C . . . . . . W 1 W .
    . . . . . . . . . . . .
    . . . . . . . . . . . .
    . . . . . 1 . . . . . .
    . . . . . . . . . . . .
    . . . . F C . . . . . .
    . . . . . . . . . . . .
    . . . . . 1 . . . . . .
    . . . . . C . . . . . .
    . . . . . . . . . . . .
    . . . . . . . . . . . .
  `,
  overlay: `
    . . . . . r . . . . . .
    . . . . . r . . . . . .
    . . . . . r . . . . . .
    . . . . . r . . . . . .
    . . . . . r . . . . . w
    . . . . . r . . . o . .
    . . . . . r . . . . . .
    . . . . . r . . . . . .
    . . . . . r . . . . . .
    . . . . . . . . . . . .
    . . . . . r . . . . . .
    . . . . . r . . . . . .
    . o . . . r . . . . . .
    . . . . . r . . . w . .
  `,
  tutorial: [
    {
      triggerId: "levelIntro",
      text: "WE HAVE TWO PROVINCES. EACH ONE KEEPS ITS OWN GOLD",
      highlightTile: { x: 5, y: 11 },
    },
    {
      triggerId: "unitSelected:first",
      text: "CAPTURE THE BRIDGE TO JOIN OUR PROVINCES. THEIR GOLD IS ADDED TOGETHER",
      highlightTile: { x: 5, y: 9 },
    },
    {
      triggerId: "turnStart:2",
      text: "TWO ENEMIES! GREEN IN THE WEST, RED BEHIND HIS WALLS IN THE NORTH-EAST",
      highlightTile: { x: 9, y: 1 },
    },
    {
      triggerId: "attackBlocked:wall",
      text: "A WOODWALL HAS STRENGTH 2. ONLY A LEVEL 3 KNIGHT CAN BREAK IT",
    },
    { triggerId: "bought:woodwall", text: "OUR OWN WALL GUARDS ITS TILE. CITIES AND KNIGHTS GUARD THEIR NEIGHBOURS TOO" },
    { triggerId: "turnStart:5", text: "A KNIGHT WITH NO FRIENDLY NEIGHBOUR STARVES. KEEP OUR LAND CONNECTED" },
    { triggerId: "enemyCityCaptured", text: "ONE KINGDOM DOWN!" },
    { triggerId: "victory", text: "THE WHOLE ISLAND IS OURS!" },
  ],
});
