import { buildAsciiMap } from "./ascii";

/**
 * Level 04 — Green Fields. Mirrors the real level 4 (`sheet-a04`/`a05`,
 * wt-0195..0235): a bridge to a northern strip, red's first city just south
 * of it, grass fields scattered about (one inside blue's own province),
 * blue's village with a woodwall in the middle, and red's second city in
 * the south-east. Teaches fields, UNDO and the two-city win.
 */
export default buildAsciiMap({
  levelId: "04",
  name: "Green Fields",
  biome: "grass",
  players: [
    { kind: "human", startGold: 9 },
    { kind: "ai", startGold: 5 },
  ],
  terrain: `
    ~ ~ . . . . . . . . ~
    ~ ~ ~ ~ ~ = ~ ~ ~ ~ ~
    ~ . . . . . . . . . ~
    ~ . f . . . T T f f ~
    ~ . . . T T T . f f .
    . . . . . T . . . . .
    . . . . . . . . . ~ ~
    . . f . . . . . . . ~
    . f . . . . . . . . .
    . . . . T . . . . f .
    . T . . T . . . . . .
    . . . . . . . . . . .
  `,
  owners: `
    . . . . . . . . . . .
    . . . . . . . . . . .
    . . . 1 1 1 1 . . . .
    . . . 1 1 1 . . . . .
    . . . . . . . . . . .
    . . 0 0 0 . . . . . .
    . . 0 0 0 . . . . . .
    . . 0 0 0 . . . . . .
    . . . 0 . . . . . . .
    . . . . . . . . . . .
    . . . . . . . . 1 1 1
    . . . . . . . . 1 1 1
  `,
  objects: `
    . . . . . . . . . . .
    . . . . . . . . . . .
    . . . . C . . . . . .
    . . . . . 1 . . . . .
    . . . . . . . . . . .
    . . . W . . . . . . .
    . . . C . . . . . . .
    . . . . 1 . . . . . .
    . . . . . . . . . . .
    . . . . . . . . . . .
    . . . . . . . . 1 . .
    . . . . . . . . . C .
  `,
  overlay: `
    . . . . . r . . . . .
    . . . . . . . . . . .
    . . . . . r r r . o .
    . w . . . . . . . . .
    . . . . . . . . . . .
    . . . . . . . . w . .
    . . . . . . . . . . .
    . . . . . o . . . . .
    . . . r . . . . . . .
    . . . r . . . . . . .
    . . . r . . . o . . .
    . . . r r r r r . . .
  `,
  tutorial: [
    {
      triggerId: "levelIntro",
      text: "WE CAN'T EARN GOLD WITH THIS GRASS FIELD",
      highlightTile: { x: 2, y: 7 },
    },
    {
      triggerId: "unitSelected:first",
      text: "MOVE A KNIGHT ONTO THE FIELD TO MOW IT. THAT ENDS HIS TURN",
      highlightTile: { x: 2, y: 7 },
    },
    { triggerId: "fieldCleared:first", text: "THE FIELD IS GONE. THE TILE EARNS GOLD AGAIN" },
    { triggerId: "turnStart:2", text: "MADE A MISTAKE? TAP UNDO TO TAKE BACK YOUR LAST MOVE" },
    { triggerId: "bought:woodwall", text: "A WOODWALL DEFENDS ITS OWN TILE WITH STRENGTH 2" },
    {
      triggerId: "turnStart:3",
      text: "RED HAS TWO PROVINCES. DESTROY BOTH CITIES TO WIN",
      highlightTile: { x: 9, y: 11 },
    },
    { triggerId: "enemyCityCaptured", text: "ONE CITY DOWN! NOW THE OTHER ONE" },
    { triggerId: "victory", text: "THE FIELDS ARE OURS!" },
  ],
});
