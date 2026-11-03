import { describe, expect, it } from "vitest";
import { CircleGeometry, InstancedMesh, MeshBasicMaterial, ShaderLib, type BufferAttribute } from "three";

import { KEEP_ATTRIBUTE, NO_BOUND, clipInstances, patchKeepShader } from "./instanceClip";

/** The basic material's shaders as three hands them to `onBeforeCompile`, patched. */
function patched(): { vertexShader: string; fragmentShader: string } {
  const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader };
  patchKeepShader(shader);
  return shader;
}

describe("per-instance clipping for the instanced batches (Plan 6, Task 33 fix round 1)", () => {
  it("discards every fragment outside its instance's box: left of minX, right of maxX, below minY", () => {
    const { vertexShader, fragmentShader } = patched();
    // The fragment's world position: the vertex through its instance's matrix, then the mesh's.
    expect(vertexShader).toContain(`attribute vec3 ${KEEP_ATTRIBUTE};`);
    expect(vertexShader).toMatch(/keepAt = instanceMatrix \* keepAt;\s*#endif\s*keepAt = modelMatrix \* keepAt;\s*vKeepAt = keepAt\.xy;\s*vKeep = instanceKeep;/);
    // The test runs first in `main`, before the colour is worked out.
    const main = fragmentShader.slice(fragmentShader.indexOf("void main()"));
    expect(main).toMatch(/^void main\(\) \{\s*vec4 diffuseColor = vec4\( diffuse, opacity \);\s*#include <clipping_planes_fragment>\s*if \( vKeepAt\.x < vKeep\.x \|\| vKeepAt\.x > vKeep\.y \|\| vKeepAt\.y < vKeep\.z \) discard;/);
  });

  it("fails loudly when three's shader no longer has the line it hangs on", () => {
    expect(() => patchKeepShader({ vertexShader: "void main() {}", fragmentShader: ShaderLib.basic.fragmentShader })).toThrow(/expected one "#include <common>"/);
  });

  it("gives every instance a box, unbounded until set, written in place and uploaded on commit", () => {
    const mesh = new InstancedMesh(new CircleGeometry(1, 8), new MeshBasicMaterial(), 3);
    const clip = clipInstances(mesh);
    const keep = mesh.geometry.getAttribute(KEEP_ATTRIBUTE) as BufferAttribute;
    const array = keep.array;
    expect(keep.count).toBe(3);
    for (let i = 0; i < 3; i++) expect([keep.getX(i), keep.getY(i), keep.getZ(i)]).toEqual([-NO_BOUND, NO_BOUND, -NO_BOUND]);
    const version = keep.version;
    clip.set(1, -4, 9, 2);
    clip.commit();
    expect([keep.getX(1), keep.getY(1), keep.getZ(1)]).toEqual([-4, 9, 2]);
    expect(keep.version).toBe(version + 1);
    expect(keep.array).toBe(array);
    const material = mesh.material as MeshBasicMaterial;
    expect(material.onBeforeCompile).toBe(patchKeepShader);
    // Its own program: a plain basic material elsewhere must not share the patched one.
    expect(material.customProgramCacheKey()).not.toBe(new MeshBasicMaterial().customProgramCacheKey());
    mesh.geometry.dispose();
    material.dispose();
  });
});
