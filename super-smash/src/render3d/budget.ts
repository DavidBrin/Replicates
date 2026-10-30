/**
 * The R§4 frame budget the 3D layer is held to (Plan 4): under 100 draw calls
 * and 500k triangles at 1080p with four fighters. A fighter costs one draw call
 * per glb primitive; `scripts/models/export_gltf.py` joins its parts to one
 * primitive per texture and `scripts/models/glb.mjs` refuses a glb with more
 * than `MAX_FIGHTER_PRIMITIVES` (its `MAX_PRIMITIVES`, pinned equal by
 * `pipeline/glb.test.ts`), so four fighters stay under half the frame.
 */

export const MAX_DRAW_CALLS = 100;
export const MAX_TRIANGLES_PER_FRAME = 500_000;
export const MAX_FIGHTER_PRIMITIVES = 12;

/**
 * The draw calls a frame spends besides the stage and the fighters: one per
 * batch, however many are up — the sparks and bursts, the shields, the blob
 * shadows (`renderer3d.ts`). `renderer3d.test.ts` holds the scene to exactly
 * this many batches, and `e2e/render3d.spec.ts` reads it rather than a copy.
 */
export const BATCH_CALLS = 3;
