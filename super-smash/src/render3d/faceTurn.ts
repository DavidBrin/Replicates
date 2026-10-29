/**
 * Faces turned toward the camera, at render only (Plan 4 Task 21c).
 *
 * The game turns a fighter a pure ±90° about the vertical (`fighter3d.ts`), and
 * the clips pose its limbs in the side plane, so every face is drawn edge-on;
 * Kirby's, the front of his round body, does not show at all. Ultimate's
 * fighters stand visibly turned toward the camera.
 *
 * Turning the whole fighter would foreshorten the drawn limbs by cos θ while
 * the sim's boxes stayed where they are. So only bones whose own origin stays
 * put are turned: a head, and Kirby's body bone (which carries his face), each
 * about the vertical through its own origin, toward the camera at +z. A bone's
 * own rotation never moves its origin, and none of these has a bone of the rig
 * below it, so no other bone that carries a hurt or hit capsule moves
 * (`faceTurn.test.ts` checks every fighter). The sim never reads the drawn
 * bones: its boxes come from the bake either way.
 */

import { Quaternion, Vector3, type Object3D } from "three";

import type { Rig3 } from "./skeleton/skeleton";

export interface FaceTurn {
  /** A bone of the fighter's rig, by its SSBU name. */
  readonly bone: string;
  /** Degrees toward the camera. */
  readonly deg: number;
}

/**
 * Each fighter's turned bones. UNVERIFIED (by eye): chosen from the match
 * camera (zoom 10, the fighter at the centre of the frame, where a face is most
 * edge-on), trying 0/10/15/20° for heads, 0/25/35/45° for Kirby and 0/20/30/40°
 * for Pikachu (Task 21c). Kirby's eyes and mouth both show from 45° (at 25° one
 * eye is a sliver); Pikachu's eye and mouth read from 30°. A head turned 15°
 * shows the eye, visor or muzzle better and nothing odd; 20° starts to show the
 * far side of the face. The polish phase tunes them with screenshots.
 */
export const FACE_TURNS: Readonly<Record<string, readonly FaceTurn[]>> = Object.freeze({
  mario: [{ bone: "Head", deg: 15 }],
  donkeyKong: [{ bone: "Head", deg: 15 }],
  link: [{ bone: "Head", deg: 15 }],
  samus: [{ bone: "Head", deg: 15 }],
  kirby: [{ bone: "Body", deg: 45 }],
  fox: [{ bone: "Head", deg: 15 }],
  pikachu: [{ bone: "Head", deg: 35 }],
  marth: [{ bone: "Head", deg: 15 }],
});

/** Turns a fighter's table bones each frame, after its pose is written; makes nothing per frame. */
export interface FaceTurner {
  apply(facing: number): void;
}

/**
 * The turner for one fighter's bones (`bindBones`' order, `rig`'s names).
 * `stop` is the group that holds the model, whose +Y is the vertical (it carries
 * the clip's scale and squash, never a rotation). A table bone the model lacks
 * is skipped: a fighter is drawn either way.
 */
export function faceTurner(rig: Rig3, bones: readonly (Object3D | null)[], stop: Object3D, turns: readonly FaceTurn[]): FaceTurner {
  const turned: { readonly bone: Object3D; readonly rad: number }[] = [];
  for (const t of turns) {
    const i = rig.byLower.get(t.bone.toLowerCase());
    const bone = i === undefined ? null : bones[i];
    if (bone !== null) turned.push({ bone, rad: (t.deg * Math.PI) / 180 });
  }
  const parentTurn = new Quaternion();
  const axis = new Vector3();
  const turn = new Quaternion();
  return {
    apply(facing) {
      for (let k = 0; k < turned.length; k++) {
        const { bone, rad } = turned[k];
        // The parent's rotation from the model group, as this frame's pose leaves it.
        parentTurn.identity();
        for (let o = bone.parent; o !== null && o !== stop; o = o.parent) parentTurn.premultiply(o.quaternion);
        // The vertical in the parent's frame; turning about it, in the bone's own
        // local rotation, keeps the bone's origin where its parent puts it.
        axis.set(0, 1, 0).applyQuaternion(parentTurn.invert());
        // Facing +x the camera at +z is a turn of −θ about +Y, facing −x one of +θ: always toward it.
        turn.setFromAxisAngle(axis, -Math.sign(facing || 1) * rad);
        bone.quaternion.premultiply(turn);
      }
    },
  };
}
