import { buildAsciiMap } from "./ascii";

/**
 * Level 03 — The Wall. Mirrors the real level 3 (`sheet-a02`/`a03`,
 * wt-0085..0195): red's city in the north behind a mountain-and-forest
 * ridge, a woodwall on the road through the ridge, blue's village south of
 * it. The only other way north is a narrow path along the west edge, held by
 * a red peasant — so the player learns farms (income) and merging (level 2).
 */
export default buildAsciiMap({
  levelId: "03",
  name: "The Wall",
  biome: "grass",
  players: [
    { kind: "human", startGold: 4 },
    { kind: "ai", startGold: 6 },
  ],
  terrain: `
    T T T T . . . ~ ~ ~
    T T T . . . . . ~ ~
    . . . . . . . . ~ ~
    . T T . . . . . . ~
    . ^ ^ ^ ^ . . . . ~
    . . T T T . T T T T
    . . . . . . . . . .
    . . . . . . . . . .
    . . . . . . . . . .
    . T . ~ ~ ~ . T . .
    . . . ~ ~ ~ . . . .
    . . . . . . . . . .
  `,
  owners: `
    . . . . . . . . . .
    . . . . 1 1 1 . . .
    . . 1 1 1 1 1 1 . .
    . . . 1 1 1 1 1 . .
    . . . . . 1 . . . .
    . . . . . 1 . . . .
    . . . 0 0 0 0 . . .
    . . . 0 0 0 0 . . .
    . . . . 0 0 . . . .
    . . . . . . . . . .
    . . . . . . . . . .
    . . . . . . . . . .
  `,
  objects: `
    . . . . . . . . . .
    . . . . . C . . . .
    . . 1 . . . . . . .
    . . . . . . 1 . . .
    . . . . . . . . . .
    . . . . . W . . . .
    . . . . . 1 . . . .
    . . . . . C . . . .
    . . . . . . . . . .
    . . . . . . . . . .
    . . . . . . . . . .
    . . . . . . . . . .
  `,
  overlay: `
    . . . . . r . . . .
    . . . . . r . . . .
    . . . . . r . w . .
    . . . . . r . . . .
    . . . . . r . . . .
    . . . . . r . . . .
    . . o . . r . . . .
    r r r r r r r r r r
    . . . . . r . . o .
    . . . . . r . . . .
    . w . . . r . . . .
    . . . . . r . . b .
  `,
  tutorial: [
    { triggerId: "levelIntro", text: "I CAN'T PASS THE WALL!", highlightTile: { x: 5, y: 5 } },
    {
      triggerId: "attackBlocked:wall",
      text: "A WOODWALL HAS STRENGTH 2. WE SHOULD COLLECT MORE GOLD AND THEN ATTACK HIM",
      highlightTile: { x: 5, y: 5 },
    },
    {
      triggerId: "turnStart:2",
      text: "A FARM EARNS 5 GOLD A DAY. TAP THE FARM CARD AND PLACE IT ON OUR LAND",
    },
    { triggerId: "bought:farm", text: "GOOD! EACH NEW FARM COSTS 2 GOLD MORE THAN THE LAST" },
    {
      triggerId: "turnStart:3",
      text: "THERE IS A PATH IN THE WEST. WE NEED A LEVEL 2 KNIGHT TO DESTROY HIM",
      highlightTile: { x: 2, y: 2 },
    },
    {
      triggerId: "attackBlocked:defence",
      text: "HIS KNIGHT GUARDS THAT TILE. WE NEED A LEVEL 2 KNIGHT TO DESTROY HIM",
      highlightTile: { x: 2, y: 2 },
    },
    { triggerId: "merged:first", text: "A LEVEL 2 KNIGHT! NOW GO WEST AND AROUND THE MOUNTAINS" },
    { triggerId: "enemyCityCaptured", text: "THE WALL COULDN'T SAVE HIM!" },
  ],
});
