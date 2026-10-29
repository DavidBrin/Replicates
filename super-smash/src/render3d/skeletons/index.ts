/**
 * The committed fighter skeletons (Plan 4 Task 6): bone names and bind
 * transforms trimmed to what the sim and the retargeter use, plus the derived
 * hurt capsules. Derived numbers only — no mesh, no texture (spec §3.1).
 */

import { parseSkeletonFile, type SkeletonFile } from "../skeleton/skeleton";
import donkeyKong from "./donkeyKong.json";
import fox from "./fox.json";
import kirby from "./kirby.json";
import link from "./link.json";
import mario from "./mario.json";
import marth from "./marth.json";
import pikachu from "./pikachu.json";
import samus from "./samus.json";

export const SKELETONS: Readonly<Record<string, SkeletonFile>> = Object.fromEntries(
  [mario, donkeyKong, link, samus, kirby, fox, pikachu, marth].map((j) => {
    const s = parseSkeletonFile(j);
    return [s.fighter, s];
  }),
);
