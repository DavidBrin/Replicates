import { buildAsciiMap } from "./ascii";

/**
 * Level 01 — First Steps. Mirrors the real level 1 (`sheet-a00`, wt-0005):
 * two blue tiles (city + knight) on the north side of a road, a red peasant
 * and city next door in the south-east, water on the west, forest on the
 * east. Blue starts with 1 gold and income 2 (D36) and must claim neutral
 * land before a second knight is affordable.
 */
export default buildAsciiMap({
  levelId: "01",
  name: "First Steps",
  biome: "grass",
  players: [
    { kind: "human", startGold: 1 },
    { kind: "ai", startGold: 2 },
  ],
  terrain: `
    ~ ~ . . T T T T
    ~ . . . . T T T
    ^ . . . . . T T
    ~ . . . . ~ . T
    ~ ~ . . . ~ . .
    ~ . . . . . . .
    ~ f . . . . . .
    ~ ~ . . . . . .
    ~ ~ . T . . . .
    ~ ~ ~ T T . . .
  `,
  owners: `
    . . . . . . . .
    . . . . . . . .
    . . 0 0 . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . 1 1 .
    . . . . . . 1 .
    . . . . . . . .
  `,
  objects: `
    . . . . . . . .
    . . . . . . . .
    . . C 1 . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . . . .
    . . . . . 1 C .
    . . . . . . . .
    . . . . . . . .
  `,
  overlay: `
    . . . . . . . .
    . w . . . . . .
    . . . . o . . .
    . . . r . . . .
    . . . r . . p .
    . . o r r . . .
    . . . . r r . .
    . . . . . . . w
    . . . . . . o .
    . . . . . b . .
  `,
  tutorial: [
    { triggerId: "levelIntro", text: "LET'S DESTROY THE ENEMY CITY", highlightTile: { x: 6, y: 7 } },
    {
      triggerId: "unitSelected:first",
      text: "THIS IS MY KNIGHT. THE LIT TILES SHOW WHERE HE CAN GO",
      highlightTile: { x: 3, y: 2 },
    },
    {
      triggerId: "captured:first",
      text: "EVERY TILE WE OWN EARNS 1 GOLD A DAY. TAP NEXT DAY WHEN YOU ARE DONE",
    },
    { triggerId: "turnStart:2", text: "OUR KNIGHT EATS 2 GOLD A DAY. CLAIM MORE LAND TO FEED HIM" },
    {
      triggerId: "attackBlocked:defence",
      text: "THE ENEMY CITY DEFENDS THE LAND AROUND IT. A LEVEL 1 KNIGHT CAN'T BEAT IT",
      highlightTile: { x: 6, y: 7 },
    },
    { triggerId: "turnStart:3", text: "WE SHOULD COLLECT MORE GOLD AND THEN ATTACK HIM" },
    { triggerId: "bought:first", text: "A NEW KNIGHT! MOVE HIM ONTO OUR OTHER KNIGHT TO MERGE THEM" },
    {
      triggerId: "merged:first",
      text: "A LEVEL 2 KNIGHT CAN DESTROY THE ENEMY CITY!",
      highlightTile: { x: 6, y: 7 },
    },
    { triggerId: "victory", text: "THE ISLAND IS OURS!" },
  ],
});
