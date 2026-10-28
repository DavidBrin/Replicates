/**
 * Every fighter's imported reference scripts, by fighter id (Plan 2, Task 16).
 * Not imported by the game, which takes each fighter's generated module
 * directly (`withReferenceScripts`, Plan 3 Task 18): the tests read it.
 */

import { DONKEY_KONG } from "./generated/donkeyKong";
import { FOX } from "./generated/fox";
import { KIRBY } from "./generated/kirby";
import { LINK } from "./generated/link";
import { MARIO } from "./generated/mario";
import { MARTH } from "./generated/marth";
import { PIKACHU } from "./generated/pikachu";
import { SAMUS } from "./generated/samus";
import type { ReferenceFighter } from "./reference";

export const REFERENCE_SCRIPTS: Readonly<Record<string, ReferenceFighter>> = {
  mario: MARIO,
  donkeyKong: DONKEY_KONG,
  link: LINK,
  samus: SAMUS,
  kirby: KIRBY,
  fox: FOX,
  pikachu: PIKACHU,
  marth: MARTH,
};
