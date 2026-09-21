import type { UnitLevel } from "@/engine/types";

import {
  ARMOUR,
  ARMOUR_LIGHT,
  HAIR,
  OUTLINE,
  SKIN,
  TROUSERS,
  WHITE,
  WOOD,
  darken,
  lighten,
} from "../palette";
import type { Pix } from "./pix";

/**
 * Knight levels 1–4 as character bitmaps (SPEC §8): L1 a peasant in the
 * owner's shirt, L2 adds a spear and a round shield, L3 a helmet and a kite
 * shield, L4 a plume, full armour and a longsword. `S` is the owner colour;
 * skin, hair, blade and stone stay constant across players.
 */

const BLADE = "#DDE3EE";
const BOOT = "#3B2417";

function legend(colour: string): Record<string, string> {
  return {
    o: OUTLINE,
    H: HAIR,
    K: SKIN,
    w: WHITE,
    S: colour,
    s: darken(colour, 0.25),
    L: lighten(colour, 0.35),
    T: TROUSERS,
    B: BOOT,
    m: ARMOUR_LIGHT,
    d: ARMOUR,
    b: BLADE,
    W: WOOD.mid,
    p: colour,
    P: lighten(colour, 0.4),
  };
}

// 14 wide × 19 tall, feet on the last row.
const PEASANT = [
  ".....oooo.....",
  "....oHHHHo....",
  "...oHHHHHHo...",
  "...oHKKKKHo...",
  "...oKwKKwKo...",
  "...oKKKKKKo...",
  "....oKKKKo....",
  "...ooSSSSoo...",
  "..oSLSSSSSSo..",
  "..oSSSSSSSSo..",
  "..oKoSSSSoKo..",
  "..oKoSssSoKo..",
  "...o.oSSo.o...",
  ".....oTTo.....",
  "....oTTTTo....",
  "....oTTTTo....",
  "....oToooTo...",
  "...oBBo.oBBo..",
  "...oooo.oooo..",
];

// 18 wide: peasant + spear on the right, round shield on the left.
const SOLDIER = [
  ".......oooo......o",
  "......oHHHHo....ob",
  ".....oHHHHHHo...ob",
  ".....oHKKKKHo...oW",
  ".....oKwKKwKo...oW",
  ".....oKKKKKKo...oW",
  "......oKKKKo....oW",
  ".....ooSSSSoo...oW",
  "....oSLSSSSSSo..oW",
  ".ooooSSSSSSSSo..oW",
  "omSSoKoSSSSoKooooW",
  "omSLSoKoSSSoKo..oW",
  "omSSSoo.oSSo.o..oW",
  ".oooo..oTTo.....oW",
  "......oTTTTo....oW",
  "......oTTTTo....oW",
  "......oToooTo...oo",
  ".....oBBo.oBBo....",
  ".....oooo.oooo....",
];

// 18 wide: helmet + kite shield + sword.
const GUARD = [
  ".......oooo.......",
  "......ommmmo......",
  ".....ommmmmmo.....",
  ".....omoooomo.....",
  ".....oKwKKwKo...ob",
  ".....oKKKKKKo...ob",
  "......oKKKKo....ob",
  ".....ooddddoo...ob",
  "....oddmdddddo..ob",
  ".ooooddddddddo..ob",
  "omSSoKoddddoKoooWo",
  "omSLSSoKoddoKooWo.",
  "omSSSSoo.oddo.oo..",
  ".oSSSo..oTTo......",
  "..oSo..oTTTTo.....",
  "...o...oTTTTo.....",
  ".......oToooTo....",
  "......oBBo.oBBo...",
  "......oooo.oooo...",
];

// 18 wide × 23 tall: plume above, full armour, longsword. Feet on the last row.
const KNIGHT = [
  "........opo.......",
  ".......opppo......",
  ".......oPppo......",
  "........opo.......",
  ".......oooo.......",
  "......ommmmo....ob",
  ".....ommmmmmo...ob",
  ".....ommoommo...ob",
  ".....omKwwKmo...ob",
  ".....ommmmmmo...ob",
  "......oooooo....ob",
  ".....oodddddoo..ob",
  "....odmdddddddo.ob",
  ".ooooddmddddddo.ob",
  "omSSoKoddddddoKoWo",
  "omSLSSoKoddddoKoWo",
  "omSSSSoo.odddo.oo.",
  ".oSSSo..oTTTTo....",
  "..oSo..oTTTTTTo...",
  "...o...oTTTTTTo...",
  ".......oToooooTo..",
  "......oBBo..oBBo..",
  "......oooo..oooo..",
];

const BITMAPS: Record<UnitLevel, readonly string[]> = {
  1: PEASANT,
  2: SOLDIER,
  3: GUARD,
  4: KNIGHT,
};

export function paintKnight(p: Pix, level: UnitLevel, colour: string): void {
  const rows = BITMAPS[level];
  const w = rows[0]?.length ?? 14;
  const h = rows.length;
  const x = Math.floor((32 - w) / 2);
  const feet = 30;
  const y = feet - h;
  // drop shadow
  p.ctx.save();
  p.ctx.globalAlpha = 0.22;
  p.rect(9, 29, 14, 2, OUTLINE);
  p.ctx.restore();
  p.bitmap(rows, legend(colour), x, y);
}
