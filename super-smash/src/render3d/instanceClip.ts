/**
 * Per-instance clipping for the instanced batches (Plan 6, Task 33 fix round 1).
 *
 * The stage writes no depth (ruling D11), so it no longer hides what reaches
 * into it: a grounded shield's cap below its fighter's floor, and the part of a
 * tipped blob shadow past the end of the surface it lies on, drew over the lip
 * and the front face, or in the air past a ledge. Each instance therefore
 * carries a box to keep (`instanceKeep`: world x from `minX` to `maxX`, world y
 * from `minY` up), and the fragment shader discards what falls outside it.
 *
 * A clipping plane would be the material's, the same for every instance, and the
 * fighters stand on different floors; so the bound is an instance attribute, and
 * each batch stays one draw call. The buffer is made once and written in place:
 * the render loop allocates nothing.
 */

import { DynamicDrawUsage, InstancedBufferAttribute, type InstancedMesh, type Material } from "three";

/** A bound so far off it never clips: "no bound" on that side. */
export const NO_BOUND = 1e6;

/** The attribute each instance's box to keep rides in: (minX, maxX, minY). */
export const KEEP_ATTRIBUTE = "instanceKeep";

export interface InstanceClip {
  /** Instance `i` draws only where world x is within [`minX`, `maxX`] and world y is at least `minY`. */
  set(i: number, minX: number, maxX: number, minY: number): void;
  /** Upload this frame's writes. */
  commit(): void;
}

/** `source` with `anchor` (present exactly once) followed by `extra`; a three upgrade that moves the anchor fails loudly. */
function after(source: string, anchor: string, extra: string): string {
  const parts = source.split(anchor);
  if (parts.length !== 2) throw new Error(`instanceClip: expected one "${anchor}" in the shader, found ${parts.length - 1}`);
  return parts[0] + anchor + extra + parts[1];
}

/**
 * Patch a basic material's shaders (`onBeforeCompile`): the vertex shader hands
 * each fragment its world x and y and its instance's box, and the fragment
 * shader discards whatever is outside the box.
 */
export function patchKeepShader(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = after(shader.vertexShader, "#include <common>", `\nattribute vec3 ${KEEP_ATTRIBUTE};\nvarying vec3 vKeep;\nvarying vec2 vKeepAt;`);
  shader.vertexShader = after(
    shader.vertexShader,
    "#include <project_vertex>",
    `\n\tvec4 keepAt = vec4( transformed, 1.0 );\n\t#ifdef USE_INSTANCING\n\t\tkeepAt = instanceMatrix * keepAt;\n\t#endif\n\tkeepAt = modelMatrix * keepAt;\n\tvKeepAt = keepAt.xy;\n\tvKeep = ${KEEP_ATTRIBUTE};`,
  );
  shader.fragmentShader = after(shader.fragmentShader, "#include <common>", "\nvarying vec3 vKeep;\nvarying vec2 vKeepAt;");
  shader.fragmentShader = after(
    shader.fragmentShader,
    "#include <clipping_planes_fragment>",
    "\n\tif ( vKeepAt.x < vKeep.x || vKeepAt.x > vKeep.y || vKeepAt.y < vKeep.z ) discard;",
  );
}

/** Give `mesh` a box to keep per instance, every one unbounded until `set`. Its material is patched (`patchKeepShader`). */
export function clipInstances(mesh: InstancedMesh): InstanceClip {
  const capacity = mesh.instanceMatrix.count;
  const keep = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  keep.setUsage(DynamicDrawUsage);
  for (let i = 0; i < capacity; i++) keep.setXYZ(i, -NO_BOUND, NO_BOUND, -NO_BOUND);
  mesh.geometry.setAttribute(KEEP_ATTRIBUTE, keep);
  const material = mesh.material as Material;
  material.onBeforeCompile = patchKeepShader;
  material.customProgramCacheKey = () => KEEP_ATTRIBUTE;
  return {
    set(i, minX, maxX, minY) {
      keep.setXYZ(i, minX, maxX, minY);
    },
    commit() {
      keep.needsUpdate = true;
    },
  };
}
