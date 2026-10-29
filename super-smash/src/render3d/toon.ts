/**
 * The fighters' material: Ultimate-ish cel shading — a three-step toon ramp on
 * the c00 colour texture plus a view-facing rim — in one `MeshToonMaterial`
 * per glb material, so a fighter costs one draw call per material and no extra
 * pass (`forceSinglePass`: three would draw a transparent double-sided part
 * twice, and a fading fighter's every part is transparent). `hitFlash` (D21's
 * flash on a hit victim) drives the emissive, lit by the fighter's own colour
 * texture, so a hit brightens the fighter and never bleaches or fades it.
 *
 * Alpha is the glb's own. The export decides each material's glTF alpha mode
 * from its texture (Plan 4 Task 8: OPAQUE, MASK for cut-outs such as eyes and
 * hair cards, BLEND only for a see-through part such as Fox's scouter), three's
 * GLTFLoader turns that into `transparent`/`alphaTest`/`opacity`/`depthWrite`,
 * and `toonFor` keeps all four. Intangibility fades a fighter (`setFade`): the
 * material turns transparent only while it fades and returns to its exported
 * mode after. Every fighter has its own copies (`fighter3d.ts`), so one
 * fighter's blink never fades another's.
 */

import {
  Color,
  DataTexture,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  type Material,
  type Side,
  type Texture,
} from "three";

/**
 * Lit, mid, shadow — three bands, as Ultimate's toon ramp reads at a distance:
 * 255/170/90 as sRGB, stored linear (1.0, 0.4, 0.1), because three reads a
 * RedFormat texture as linear and will not take an sRGB tag on one (it warns).
 * UNVERIFIED (by eye): the Task 19 review's measured values; polish revisits
 * them with screenshots.
 */
const RAMP = new Uint8Array([26, 102, 255]);

/** The rim's strength. UNVERIFIED (by eye): stronger washes the fighters' colours out (0.35 cost 18% of their saturation, Task 19 review). */
export const RIM_STRENGTH = 0.15;

/**
 * A hit's flash at full strength adds this much of the fighter's own colour
 * (`hitFlashAmount` peaks at 0.85, so 0.85 × 1.4 ≈ 1.2× its albedo): bright,
 * and every texture still reads. White light instead washed a struck fighter
 * to a pale ghost (Task 20's match screenshots). UNVERIFIED (by eye).
 */
export const HIT_FLASH_GAIN = 1.4;

let ramp: DataTexture | null = null;
export function toonRamp(): DataTexture {
  if (ramp === null) {
    ramp = new DataTexture(RAMP, RAMP.length, 1, RedFormat);
    ramp.minFilter = NearestFilter;
    ramp.magFilter = NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

/** The anchor the rim is spliced after; `toon.test.ts` pins that three still has it. */
export const RIM_ANCHOR = "#include <emissivemap_fragment>";
export const RIM_GLSL = `
  float rimDot = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
  totalEmissiveRadiance += rimColor * rimStrength * pow(rimDot, 3.0);
`;

/**
 * The anchor the texture's alpha is decided after, before the cut-out test.
 * glTF's OPAQUE ignores a texture's alpha; three does too while a material is
 * opaque (its OPAQUE define), but not once a fade makes it transparent, when a
 * colour texture that keeps something else in its alpha would show through.
 * `mapAlpha` 0 keeps the fade's opacity alone; 1 (MASK, BLEND) keeps the texel's.
 */
export const MAP_ALPHA_ANCHOR = "#include <map_fragment>";
export const MAP_ALPHA_GLSL = `
  diffuseColor.a = mix(opacity, diffuseColor.a, mapAlpha);
`;

/** A material's own alpha mode, as it was made: what `setFade(m, 1)` returns it to. */
export interface ToonAlpha {
  readonly transparent: boolean;
  readonly opacity: number;
  readonly alphaTest: number;
  readonly depthWrite: boolean;
}

export interface ToonMaterial extends MeshToonMaterial {
  userData: {
    rimStrength: { value: number };
    /** 0: the colour texture's alpha is ignored (OPAQUE); 1: it counts. */
    mapAlpha: { value: number };
    hitFlash: number;
    alpha: ToonAlpha;
  };
}

const alphaOf = (m: Material): ToonAlpha => ({ transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, depthWrite: m.depthWrite });
const isOpaque = (a: ToonAlpha): boolean => !a.transparent && a.alphaTest === 0;

/** An opaque toon material (the stand-in's, and the base of `toonFor`). */
export function toonMaterial(map: Texture | null, rimColor = new Color(0xffffff), rimStrength = RIM_STRENGTH): ToonMaterial {
  // The colour texture lights the hit flash too (`setHitFlash`); set here, so a flash never changes the program.
  const m = new MeshToonMaterial({ map, emissiveMap: map, gradientMap: toonRamp() }) as ToonMaterial;
  m.forceSinglePass = true;
  const strength = { value: rimStrength };
  const mapAlpha = { value: 0 };
  m.userData = { rimStrength: strength, mapAlpha, hitFlash: 0, alpha: alphaOf(m) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
    shader.uniforms.rimStrength = strength;
    shader.uniforms.mapAlpha = mapAlpha;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform vec3 rimColor;\nuniform float rimStrength;\nuniform float mapAlpha;\nvoid main() {")
      .replace(MAP_ALPHA_ANCHOR, `${MAP_ALPHA_ANCHOR}\n${MAP_ALPHA_GLSL}`)
      .replace(RIM_ANCHOR, `${RIM_ANCHOR}\n${RIM_GLSL}`);
  };
  m.customProgramCacheKey = () => "david-smash-toon-rim";
  return m;
}

/**
 * The toon material for one glb material: its colour texture, colour factor,
 * sides and name, and its exported alpha mode exactly (never forced).
 */
export function toonFor(source: Material): ToonMaterial {
  const s = source as Material & { map?: Texture | null; color?: Color; side: Side };
  const m = toonMaterial(s.map ?? null);
  m.name = source.name;
  if (s.color) m.color.copy(s.color);
  m.side = source.side;
  const alpha = alphaOf(source);
  m.transparent = alpha.transparent;
  m.opacity = alpha.opacity;
  m.alphaTest = alpha.alphaTest;
  m.depthWrite = alpha.depthWrite;
  m.userData.alpha = alpha;
  m.userData.mapAlpha.value = isOpaque(alpha) ? 0 : 1;
  return m;
}

/**
 * The flash on a hit victim (`hitFlashAmount`, 0..0.85): light in the
 * material's own colour (`color` here, times its texture through
 * `emissiveMap`), up to `HIT_FLASH_GAIN` of it. Opacity, transparency and
 * depth are never touched: only the intangibility fade (`setFade`) changes them.
 */
export function setHitFlash(m: ToonMaterial, amount: number): void {
  m.userData.hitFlash = amount;
  m.emissive.copy(m.color).multiplyScalar(amount * HIT_FLASH_GAIN);
}

/**
 * Fade to `alpha` (1 = as exported) — intangibility's blink (`intangibleAlpha`).
 * Transparent only while fading; a cut-out's threshold fades with it, so the
 * same texels are cut at any fade (texel × alpha against cutoff × alpha). The
 * program changes only when transparency turns on or off, never per blink.
 */
export function setFade(m: ToonMaterial, alpha: number): void {
  const a = m.userData.alpha;
  const transparent = a.transparent || alpha < 1;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.needsUpdate = true;
  }
  m.opacity = a.opacity * alpha;
  m.alphaTest = a.alphaTest * alpha;
}
