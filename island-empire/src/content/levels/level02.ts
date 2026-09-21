import { buildAsciiMap } from "./ascii";

/**
 * Level 02 — Two Villages. Mirrors the real level 2 (`sheet-a00`/`a01`,
 * wt-0025..0075): blue village west, red village east, a road across the
 * middle, a lake in the north, mountains in the south-west. Blue has 8 gold
 * and income 8 — one day short of a knight, so the shop teaches income.
 */
export default buildAsciiMap({
  levelId: "02",
  name: "Two Villages",
  biome: "grass",
  players: [
    { kind: "human", startGold: 8 },
    { kind: "ai", startGold: 4 },
  ],
  terrain: `
    . . T T ~ ~ T T T T
    . . . . ~ ~ . T T .
    . . . T T . . . . .
    . . . T T . . . . .
    . . . . . . . . . .
    . . . ~ ~ ~ . . . .
    ^ ^ . ~ ~ ~ . T . .
    ^ ^ ~ ~ ~ ~ ~ . . .
  `,
  owners: `
    . . . . . . . . . .
    . . . . . . . . . .
    0 0 . . . . . . 1 1
    0 0 0 . . . . 1 1 1
    0 0 0 . . . . . 1 1
    . . . . . . . . . .
    . . . . . . . . . .
    . . . . . . . . . .
  `,
  objects: `
    . . . . . . . . . .
    . . . . . . . . . .
    . . . . . . . . . .
    . C . . . . . 1 . C
    . . 1 . . . . . . .
    . . . . . . . . . .
    . . . . . . . . . .
    . . . . . . . . . .
  `,
  overlay: `
    . . . . . . . . . .
    w . . . . . . . . p
    . . . . . . o . . .
    . . . . . . . . . .
    . . . r r r r r . .
    . w . . . . . . o .
    . . . . . . . . . .
    . . . . . . . . b .
  `,
  tutorial: [
    { triggerId: "levelIntro", text: "OUR VILLAGE HAS GROWN. EVERY TILE PAYS 1 GOLD A DAY" },
    { triggerId: "notEnoughGold", text: "NOT ENOUGH GOLD YET. TAP NEXT DAY TO COLLECT MORE" },
    {
      triggerId: "turnStart:2",
      text: "WE CAN AFFORD A KNIGHT NOW. TAP THE KNIGHT CARD, THEN A TILE IN OUR LAND",
    },
    { triggerId: "bought:first", text: "A KNIGHT COSTS 10 GOLD AND EATS 2 GOLD A DAY" },
    {
      triggerId: "attackBlocked:defence",
      text: "HIS KNIGHT PROTECTS THE TILES AROUND HIM. WE NEED A LEVEL 2 KNIGHT",
      highlightTile: { x: 7, y: 3 },
    },
    { triggerId: "merged:first", text: "MERGED! A LEVEL 2 KNIGHT BEATS A LEVEL 1 KNIGHT AND A CITY" },
    { triggerId: "enemyCityCaptured", text: "THE ENEMY CITY FALLS!" },
  ],
});
