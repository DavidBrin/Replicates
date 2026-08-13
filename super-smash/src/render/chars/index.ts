/**
 * One directory per fighter, three files each.
 *
 * `rig.ts` is what they look like standing still — proportions, palette roles,
 * the props that break their outline. `poses.ts` is any clip they play
 * differently from everybody else. `fx.ts` is what their moves paint on top:
 * the plasma, the rock, the electricity, and their own projectiles.
 *
 * The split is not filing for its own sake. Making eight characters look like
 * themselves is eight independent jobs that touch almost nothing in common,
 * and the only thing that made it one job was that all eight lived in the same
 * three files. Now the only shared files are the kits (`rigKit`, `fxKit`) and
 * the clip library, and none of those need editing to make a fighter look
 * right.
 */

import type { CharacterRig } from "../rigKit";
import { DEFAULT_RIG } from "../rigKit";
import type { FxFn, ProjectilePainter } from "../fxKit";
import type { MoveSlot } from "@/engine/types";
import { charKey } from "./poses";

import { rig as mario } from "./mario/rig";
import { rig as donkeyKong } from "./donkeyKong/rig";
import { rig as link } from "./link/rig";
import { rig as samus } from "./samus/rig";
import { rig as kirby } from "./kirby/rig";
import { rig as fox } from "./fox/rig";
import { rig as pikachu } from "./pikachu/rig";
import { rig as marth } from "./marth/rig";

import * as marioFx from "./mario/fx";
import * as donkeyKongFx from "./donkeyKong/fx";
import * as linkFx from "./link/fx";
import * as samusFx from "./samus/fx";
import * as kirbyFx from "./kirby/fx";
import * as foxFx from "./fox/fx";
import * as pikachuFx from "./pikachu/fx";
import * as marthFx from "./marth/fx";

export { CHARACTER_POSES, charKey, clipFor, overrides, type PoseOverrides } from "./poses";

export const CHARACTER_RIGS: Readonly<Record<string, CharacterRig>> = {
  mario,
  donkeykong: donkeyKong,
  dk: donkeyKong,
  link,
  samus,
  kirby,
  fox,
  pikachu,
  marth,
};

/**
 * Look a rig up by fighter id.
 *
 * An unknown id falls back to the reference humanoid, which is ugly but never
 * throws — a renderer that crashes on an unrecognised fighter takes the whole
 * match with it.
 */
export function getCharacterRig(id: string | null | undefined): CharacterRig {
  return CHARACTER_RIGS[charKey(id)] ?? DEFAULT_RIG;
}

interface FxModule {
  readonly fx: Partial<Record<MoveSlot, FxFn>>;
  readonly projectiles?: Readonly<Record<string, ProjectilePainter>>;
}

const FX_MODULES: Readonly<Record<string, FxModule>> = {
  mario: marioFx,
  donkeykong: donkeyKongFx,
  dk: donkeyKongFx,
  link: linkFx,
  samus: samusFx,
  kirby: kirbyFx,
  fox: foxFx,
  pikachu: pikachuFx,
  marth: marthFx,
};

/** What this fighter paints for this move, if anything. */
export function fxFor(id: string | null | undefined, slot: MoveSlot): FxFn | undefined {
  return FX_MODULES[charKey(id)]?.fx[slot];
}

/**
 * How this fighter paints one of their own projectiles.
 *
 * Keyed by the projectile's own def id rather than by the move that spawned
 * it, because one move can spawn several — Link's bomb and its explosion — and
 * because a projectile outlives the move.
 */
export function projectilePainterFor(
  id: string | null | undefined,
  projectileId: string,
): ProjectilePainter | undefined {
  return FX_MODULES[charKey(id)]?.projectiles?.[projectileId];
}

/**
 * Every `"<fighter>.<slot>"` the roster paints.
 *
 * Exported so a test can check each names a move that actually exists — a typo
 * is silent, and the symptom is a special that quietly looks like every other
 * special, which is the exact bug this layer was written to fix.
 */
export const MOVE_FX_KEYS: readonly string[] = Object.entries(FX_MODULES)
  // `dk` and `donkeykong` are the same module; list each fighter once.
  .filter(([key]) => key !== "dk")
  .flatMap(([key, mod]) => Object.keys(mod.fx).map((slot) => `${key}.${slot}`));

/** Every projectile painter the roster declares, for the same reason. */
export const PROJECTILE_PAINTER_KEYS: readonly string[] = Object.entries(FX_MODULES)
  .filter(([key]) => key !== "dk")
  .flatMap(([key, mod]) => Object.keys(mod.projectiles ?? {}).map((p) => `${key}.${p}`));
