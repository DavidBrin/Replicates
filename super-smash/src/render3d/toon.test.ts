import { describe, expect, it } from "vitest";
import { DataTexture, DoubleSide, FrontSide, Mesh, MeshStandardMaterial, NormalBlending, ShaderChunk, ShaderLib, type Material } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { HIT_FLASH_GAIN, MAP_ALPHA_ANCHOR, RIM_ANCHOR, RIM_STRENGTH, setFade, setHitFlash, toonFor, toonMaterial, toonRamp } from "./toon";

/** Run a material's `onBeforeCompile` on three's own toon shader, as the renderer would. */
function compiled(m: ReturnType<typeof toonMaterial>) {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, fragmentShader: ShaderLib.toon.fragmentShader, vertexShader: ShaderLib.toon.vertexShader };
  m.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

/**
 * The smallest glb that carries `materials`: one triangle, one primitive per
 * material, no textures. Synthetic: no real model is read (Plan 4 rule).
 */
function tinyGlb(materials: readonly object[]): ArrayBuffer {
  const bin = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    materials,
    meshes: [{ primitives: materials.map((_, i) => ({ attributes: { POSITION: 0 }, material: i })) }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  view.setUint32(20 + jsonLength, bin.byteLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true); // "BIN\0"
  out.set(bin, 28 + jsonLength);
  return out.buffer;
}

/** The materials three's own GLTFLoader makes of `materials`, by name. */
async function loaded(materials: readonly object[]): Promise<Map<string, Material>> {
  const gltf = await new GLTFLoader().parseAsync(tinyGlb(materials), "");
  const out = new Map<string, Material>();
  gltf.scene.traverse((o) => {
    if ((o as Mesh).isMesh) {
      const m = (o as Mesh).material as Material;
      out.set(m.name, m);
    }
  });
  return out;
}

describe("the toon + rim material", () => {
  it("splices the rim into three's own toon shader (fails if a three upgrade moves the anchor)", () => {
    expect(ShaderLib.toon.fragmentShader).toContain(RIM_ANCHOR);
    // `vViewPosition` (the rim's view vector) is declared by a chunk the toon shader includes.
    expect(ShaderChunk.normal_fragment_begin).toContain("vViewPosition");
    const m = toonMaterial(null);
    const shader = compiled(m);
    expect(shader.fragmentShader).toContain("rimStrength * pow(rimDot, 3.0)");
    expect(shader.fragmentShader.indexOf("uniform float rimStrength")).toBeLessThan(shader.fragmentShader.indexOf("void main()"));
    expect(shader.uniforms.rimStrength).toBe(m.userData.rimStrength);
  });

  it("decides a texel's alpha before the cut-out test, so an OPAQUE material ignores its texture's alpha (glTF)", () => {
    expect(ShaderLib.toon.fragmentShader).toContain(MAP_ALPHA_ANCHOR);
    const m = toonMaterial(null);
    const shader = compiled(m);
    const mix = shader.fragmentShader.indexOf("diffuseColor.a = mix(opacity, diffuseColor.a, mapAlpha)");
    expect(mix).toBeGreaterThan(shader.fragmentShader.indexOf(MAP_ALPHA_ANCHOR));
    expect(mix).toBeLessThan(shader.fragmentShader.indexOf("#include <alphatest_fragment>"));
    expect(shader.fragmentShader.indexOf("uniform float mapAlpha")).toBeLessThan(shader.fragmentShader.indexOf("void main()"));
    expect(shader.uniforms.mapAlpha).toBe(m.userData.mapAlpha);
  });

  it("is opaque when made from nothing (the stand-in)", () => {
    const m = toonMaterial(null);
    expect(m.transparent).toBe(false);
    expect(m.alphaTest).toBe(0);
    expect(m.opacity).toBe(1);
    expect(m.userData.mapAlpha.value).toBe(0);
  });

  it("keeps each glb material's own alpha mode, as three's GLTFLoader reads it: OPAQUE, MASK and BLEND", async () => {
    const byName = await loaded([
      { name: "skin", pbrMetallicRoughness: { baseColorFactor: [0.5, 0.02, 0.05, 1] } },
      { name: "hair", alphaMode: "MASK", alphaCutoff: 0.4, doubleSided: true },
      { name: "eye", alphaMode: "MASK" },
      { name: "scouter", alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [0.007, 0.266, 0.032, 0.851] } },
    ]);
    const skin = toonFor(byName.get("skin")!);
    expect([skin.transparent, skin.alphaTest, skin.opacity, skin.depthWrite]).toEqual([false, 0, 1, true]);
    expect(skin.userData.mapAlpha.value).toBe(0);
    expect(skin.color.getHex()).toBe((byName.get("skin") as MeshStandardMaterial).color.getHex());
    expect(skin.side).toBe(FrontSide);
    expect(skin.name).toBe("skin");

    const hair = toonFor(byName.get("hair")!);
    expect([hair.transparent, hair.alphaTest, hair.opacity]).toEqual([false, 0.4, 1]);
    expect(hair.userData.mapAlpha.value).toBe(1);
    expect(hair.side).toBe(DoubleSide);
    expect(toonFor(byName.get("eye")!).alphaTest).toBe(0.5);

    const scouter = toonFor(byName.get("scouter")!);
    expect([scouter.transparent, scouter.depthWrite, scouter.alphaTest]).toEqual([true, false, 0]);
    expect(scouter.opacity).toBeCloseTo(0.851, 6);
    expect(scouter.userData.mapAlpha.value).toBe(1);
  });

  it("fades by opacity alone, keeping a cut-out's cut where its texture puts it, and gives the exported mode back", () => {
    const opaque = toonFor(new MeshStandardMaterial());
    const mask = toonFor(new MeshStandardMaterial({ alphaTest: 0.5 }));
    const blend = toonFor(new MeshStandardMaterial({ transparent: true, depthWrite: false, opacity: 0.8 }));
    const before = [opaque, mask, blend].map((m) => m.version);

    for (const m of [opaque, mask, blend]) setFade(m, 0.42);
    expect([opaque.transparent, opaque.opacity, opaque.alphaTest]).toEqual([true, 0.42, 0]);
    // Texel alpha × 0.42 against 0.5 × 0.42: the same texels are cut as unfaded.
    expect([mask.transparent, mask.opacity, mask.alphaTest]).toEqual([true, 0.42, 0.5 * 0.42]);
    expect([blend.transparent, blend.depthWrite]).toEqual([true, false]);
    expect(blend.opacity).toBeCloseTo(0.8 * 0.42, 12);
    // Becoming transparent changes the program (three drops its OPAQUE define); the blend was already.
    expect([opaque, mask, blend].map((m, i) => m.version - before[i])).toEqual([1, 1, 0]);

    // A blink between two faded values is a uniform change, never a recompile.
    const mid = [opaque, mask, blend].map((m) => m.version);
    for (const m of [opaque, mask, blend]) setFade(m, 0.8);
    expect([opaque, mask, blend].map((m) => m.version)).toEqual(mid);

    for (const m of [opaque, mask, blend]) setFade(m, 1);
    expect([opaque.transparent, opaque.opacity, opaque.alphaTest]).toEqual([false, 1, 0]);
    expect([mask.transparent, mask.opacity, mask.alphaTest]).toEqual([false, 1, 0.5]);
    expect([blend.transparent, blend.opacity, blend.depthWrite]).toEqual([true, 0.8, false]);
  });

  it("flashes a hit (D21) as light in the fighter's own colours, capped, never touching its alpha or its program", () => {
    const texture = new DataTexture(new Uint8Array([200, 120, 40, 255]), 1, 1);
    const materials = [
      toonMaterial(null),
      toonMaterial(texture),
      toonFor(new MeshStandardMaterial({ map: texture, color: 0x884422 })),
      toonFor(new MeshStandardMaterial({ alphaTest: 0.5 })),
      toonFor(new MeshStandardMaterial({ transparent: true, depthWrite: false, opacity: 0.8 })),
    ];
    for (const m of materials) {
      // The texture lights the flash too, so a texel brightens in its own colour instead of washing to white.
      expect(m.emissiveMap).toBe(m.map);
      const alpha = [m.transparent, m.opacity, m.alphaTest, m.depthWrite, m.blending, m.version];
      setHitFlash(m, 0.85);
      expect(m.emissive.r).toBeCloseTo(m.color.r * 0.85 * HIT_FLASH_GAIN, 12);
      expect(m.emissive.g).toBeCloseTo(m.color.g * 0.85 * HIT_FLASH_GAIN, 12);
      expect(m.emissive.b).toBeCloseTo(m.color.b * 0.85 * HIT_FLASH_GAIN, 12);
      expect([m.transparent, m.opacity, m.alphaTest, m.depthWrite, m.blending, m.version]).toEqual(alpha);
      expect(m.blending).toBe(NormalBlending);
      setHitFlash(m, 0);
      expect(m.emissive.getHex()).toBe(0);
    }
    // UNVERIFIED (by eye): the cap, pinned so a change is deliberate.
    expect(HIT_FLASH_GAIN).toBe(2.5);
  });

  it("has the look's values, drawn in one pass (UNVERIFIED by eye: pinned so any change is deliberate)", () => {
    expect(RIM_STRENGTH).toBe(0.15);
    expect(toonMaterial(null).userData.rimStrength.value).toBe(0.15);
    // 90/170/255 as linear bytes: a RedFormat ramp cannot be tagged sRGB, so three reads it as linear.
    expect([...(toonRamp().image.data as Uint8Array)]).toEqual([26, 102, 255]);
    // A transparent double side is otherwise two draws (three's back-then-front pass): a fading fighter's every part.
    for (const m of [toonMaterial(null), toonFor(new MeshStandardMaterial({ side: DoubleSide, transparent: true }))]) expect(m.forceSinglePass).toBe(true);
  });
});
