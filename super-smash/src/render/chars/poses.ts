/**
 * Which clip a given fighter plays for a given pose.
 *
 * The shared library is still the default and still carries every clip. This
 * layer only asks one further question before handing one over: does *this*
 * fighter author their own?
 *
 * ## Why the default stays
 *
 * Eight fighters × fifty clips is four hundred animations, and the reason the
 * library is shared is that nobody is going to write four hundred. Proportion
 * carries most of the identity for free — Donkey Kong's forward smash is
 * Mario's played on arms half again as long, and it reads as Donkey Kong's.
 *
 * ## Why an override was needed anyway
 *
 * It stops working at the specials, and it stops working badly. There are four
 * special clips and thirty-two specials, so Samus's Charge Shot and Kirby's
 * Stone were the same animation. `specialFx.ts` patched over that with props —
 * the plasma, the rock — but a prop cannot fix a pose that is wrong: Marth's
 * Shield Breaker is a two-handed overhead thrust and Pikachu's Thunder Jolt is
 * a cheek-sparking hop, and no amount of glow makes one of them look like the
 * other.
 *
 * It also stops working for the handful of *normals* whose shape is the
 * character rather than the archetype. Link's forward smash is a sword coming
 * down; Kirby's is a hammer; Samus's is a plasma whip. Those are different
 * animations, not one animation with different arms.
 *
 * So: name a clip here and this fighter plays it. Name nothing and nothing
 * changes.
 */

import type { PoseClip } from "../poses/clip";
import type { PoseName } from "../poses/library";
import { POSE_LIBRARY } from "../poses/library";

import { poses as mario } from "./mario/poses";
import { poses as donkeyKong } from "./donkeyKong/poses";
import { poses as link } from "./link/poses";
import { poses as samus } from "./samus/poses";
import { poses as kirby } from "./kirby/poses";
import { poses as fox } from "./fox/poses";
import { poses as pikachu } from "./pikachu/poses";
import { poses as marth } from "./marth/poses";

export type PoseOverrides = Partial<Record<PoseName, PoseClip>>;

export const CHARACTER_POSES: Readonly<Record<string, PoseOverrides>> = {
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
 * Normalise a fighter id the way `getCharacterRig` does.
 *
 * `fighters/` is authored independently and could plausibly spell Donkey Kong
 * `donkeyKong`, `donkey-kong` or `dk`. Getting this wrong is not a crash, it is
 * a fighter who silently keeps the shared clips — which is exactly the failure
 * the lab's fighter dropdown already made once, and which looked like the
 * animation being wrong rather than the lookup.
 */
export function charKey(id: string | null | undefined): string {
  return id ? id.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

/** The clip `fighterId` plays for `name` — their own if they have one. */
export function clipFor(fighterId: string | null | undefined, name: PoseName): PoseClip {
  return CHARACTER_POSES[charKey(fighterId)]?.[name] ?? POSE_LIBRARY[name];
}

/** Whether this fighter authors their own version of a clip. */
export function overrides(fighterId: string | null | undefined, name: PoseName): boolean {
  return CHARACTER_POSES[charKey(fighterId)]?.[name] !== undefined;
}
