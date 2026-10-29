/**
 * The 3D effects: hit sparks and KO blasts as instanced sprites, and the
 * shield bubble as an instanced sphere — the sim's own bubble, health and all.
 *
 * Two draw calls whatever is happening on screen — one InstancedMesh of quads
 * for every spark and burst in `VfxState.particles`, one of spheres for up to
 * four shields — which is what keeps a four-player pile-up inside the R§4
 * budget. Every other particle kind (dust, rings, smoke, motes) stays on the 2D
 * overlay, drawn by `drawParticles` with the 3D kinds excluded.
 *
 * A spark is drawn over everything, as the 2D overlay always drew it: the sprites
 * take no depth test, so neither the stage's front face nor a fat fighter's own
 * body (Donkey Kong's bust is 6.09 across) can hide the one frame a player most
 * needs to read. The shield bubble keeps the depth test: the floor clipping its
 * lower half is natural, and the fighter inside shows through its front.
 *
 * Shapes and timings are the 2D ones (D36: a spark is a third of a fighter and
 * gone in a tenth of a second); only the drawing moved. Where they spawn is
 * not this file's: `ingestEvents` puts a hit's sparks at the point the box
 * touched the body (`HitEvent.contactX/Y`, ruling R9), so a sword's spark is on
 * the victim and not a blade's length away at the box's near end.
 *
 * Nothing here makes an object, a string or a buffer once it is running. The
 * instances are two fixed buffers written in place (`count` says how many are
 * live, so a quiet frame is a smaller draw, not a smaller array); the
 * geometries, materials and the star texture are made once; the maths objects
 * are reused; and a colour is read off its `#rrggbb` string a character at a
 * time, because three's own parser makes a regular expression match for every
 * call and a busy frame has hundreds of sparks. (What V8 boxes for a double
 * while the code is still in its middle tier is its own business and not ours
 * to test: it measured from nothing to 11 KB a frame with 340 sparks up.)
 * `shieldLook` makes one small object per shielding fighter, plus the capsule
 * `shieldBubble` itself returns, which is the sim's call to make.
 */

import {
  AdditiveBlending,
  Color,
  DataTexture,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from "three";

import { SHIELD_RELEASE_FRAMES } from "@/engine/constants";
import { toFloat } from "@/engine/fixed";
import { shieldBubble } from "@/engine/shield";
import type { FighterDef, FighterState } from "@/engine/types";
import { PORT_COLOURS } from "@/render/rigKit";
import { BURST_MAX_GROWTH, type ParticleKind, type VfxState } from "@/render/vfx";

/** Particle kinds the 3D layer draws; `drawParticles` skips them in 3D mode. */
export const SPRITE_KINDS: ReadonlySet<ParticleKind> = new Set<ParticleKind>(["spark", "burst"]);
/** The 2D pool's own cap (`MAX_PARTICLES`), so a full pool is a full buffer. */
export const MAX_SPRITES = 640;
export const MAX_SHIELDS = 4;
/**
 * Sprites sit in the fighters' own plane, z = 0: the one plane where the side
 * camera puts a point exactly where the 2D overlay's `worldToScreen` does. Any z in
 * front of it is a perspective shift, about 1.7 units at the screen's edge for z = 4,
 * where a KO's blast is. Nothing hides a sprite (`depthTest` is off), so it needs no
 * depth to get in front.
 */
export const SPRITE_Z = 0;
/**
 * Drawn after everything else that is sorted by depth. All of it is at the same depth
 * in the fighters' plane, so without this a spark would be drawn under a translucent
 * fighter or shadow whenever that mesh happened to be made after it. UNVERIFIED
 * (cosmetic): any number above the bubbles' 0 would do.
 */
const SPRITE_RENDER_ORDER = 1;
/**
 * The longest a spark's streak gets, in units: the 2D overlay's 30 px cap at the
 * 6 px a unit a match opens at. UNVERIFIED (cosmetic): by eye.
 */
const MAX_TRAIL = 30 / 6;
/** The 2D streak's length for a speed: `speed × 2.2` (`drawParticles`). */
const TRAIL_PER_SPEED = 2.2;

/* ------------------------------------------------------------- shield -- */

export interface ShieldLook {
  /** World units: the sim's own bubble (`shieldBubble`, Plan 3). */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
  readonly colour: string;
}

function shielding(f: Pick<FighterState, "action">): boolean {
  return f.action === "shieldStart" || f.action === "shield" || f.action === "shieldStun" || f.action === "shieldRelease";
}

/**
 * The bubble a shielding fighter shows: exactly the sim's `shieldBubble` — its
 * centre and its health-scaled radius — so what blocks is what you see, fading
 * in on raise and out on release, white while a perfect shield flashes. Null
 * when not shielding.
 *
 * The centre is where Plan 3 put it, half-way up the legacy box (`shieldBubble`'s
 * UNVERIFIED stand-in for the game's shield bone, carried to Plan 5, R11). The
 * 3D layer takes it from the sim rather than from a bone of its own, so the day
 * the sim moves it the drawing moves with it.
 */
export function shieldLook(
  f: Pick<FighterState, "action" | "actionFrame" | "shieldHealth" | "port" | "x" | "y">,
  def: FighterDef,
  parryFlash: number,
): ShieldLook | null {
  if (!shielding(f)) return null;
  const c = shieldBubble(f, def);
  let alpha = 0.42;
  let colour = PORT_COLOURS[f.port % PORT_COLOURS.length];
  if (parryFlash > 0) {
    alpha = 0.35 + (parryFlash / 10) * 0.6;
    colour = "#FFFFFF";
  } else if (f.action === "shieldStart") {
    alpha *= Math.min(1, f.actionFrame / 3 + 0.35);
  } else if (f.action === "shieldRelease") {
    alpha *= Math.max(0, 1 - f.actionFrame / SHIELD_RELEASE_FRAMES);
  }
  return { x: toFloat(c.x1), y: toFloat(c.y1), radius: toFloat(c.r), alpha, colour };
}

/* ------------------------------------------------------------- colour -- */

/** A hex digit's value, or −1. */
function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

/** The byte at `s[i..i+2]`, or −1. */
function hexByte(s: string, i: number): number {
  const hi = hexDigit(s.charCodeAt(i));
  const lo = hexDigit(s.charCodeAt(i + 1));
  return hi < 0 || lo < 0 ? -1 : hi * 16 + lo;
}

/**
 * `colour` into `out`, as `new Color(colour)` would read it (an sRGB string into
 * three's linear working space) — for `#rrggbb`, the one form the particles use,
 * without a string or a match made on the way. Anything else takes three's own
 * parser.
 */
function setColour(out: Color, colour: string): Color {
  if (colour.length === 7 && colour.charCodeAt(0) === 35) {
    const r = hexByte(colour, 1);
    const g = hexByte(colour, 3);
    const b = hexByte(colour, 5);
    if (r >= 0 && g >= 0 && b >= 0) return out.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
  }
  return out.set(colour);
}

/* ------------------------------------------------------------ sprites -- */

/** A soft four-point star, generated — no texture file to fetch. */
function starTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;
      const r = Math.hypot(u, v) * 2;
      const arms = Math.min(Math.abs(u), Math.abs(v)) * 6;
      const a = Math.max(0, 1 - r) ** 1.5 * Math.max(0, 1 - arms) + Math.max(0, 1 - r * 2.2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * An instanced mesh with its per-instance colour buffer already there. three adds
 * the buffer on the first `setColorAt`, and a mesh that gains one after it has
 * been drawn is a new shader program: a hitch on the first spark of a match.
 */
function instanced(name: string, geometry: PlaneGeometry | SphereGeometry, material: MeshBasicMaterial, count: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.setColorAt(0, new Color(1, 1, 1));
  mesh.instanceColor!.setUsage(DynamicDrawUsage);
  return mesh;
}

export interface Vfx3D {
  /** Holds the "sparks" and "shields" meshes; the presenter adds it to the scene. */
  readonly group: Group;
  /** `shields[port]`: that fighter's bubble this frame, or null. */
  update(v: VfxState, shields: readonly (ShieldLook | null)[]): void;
  /** Instances drawn last update, for tests and `__smashRender.info()`. */
  counts(): { sprites: number; shields: number };
  dispose(): void;
}

export function createVfx3D(): Vfx3D {
  const group = new Group();
  group.name = "vfx";
  const texture = starTexture();
  const spriteMaterial = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending });
  const sprites = instanced("sparks", new PlaneGeometry(1, 1), spriteMaterial, MAX_SPRITES);
  sprites.renderOrder = SPRITE_RENDER_ORDER;
  const shieldMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const bubbles = instanced("shields", new SphereGeometry(1, 24, 16), shieldMaterial, MAX_SHIELDS);
  group.add(sprites, bubbles);

  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  const c = new Color();
  let spriteCount = 0;
  let shieldCount = 0;

  return {
    group,
    update(v, shields) {
      spriteCount = 0;
      const particles = v.particles;
      // Past the cap this stops at the first 640, dropping the newest; the 2D pool's `push` drops the
      // oldest. Unreachable today: the pool holds every kind of particle to the same 640.
      for (let i = 0; i < particles.length && spriteCount < MAX_SPRITES; i++) {
        const part = particles[i];
        if (!SPRITE_KINDS.has(part.kind)) continue;
        const t = part.life / part.maxLife;
        if (part.kind === "spark") {
          // A streak stretched back along its own velocity (D36).
          const heading = Math.atan2(part.vy, part.vx);
          // `Math.hypot` would box its result: 16 bytes a spark a frame.
          const trail = Math.min(MAX_TRAIL, Math.sqrt(part.vx * part.vx + part.vy * part.vy) * TRAIL_PER_SPEED);
          q.setFromAxisAngle(zAxis, heading);
          s.set(Math.max(part.size, trail), Math.max(0.15, part.size * 0.7), 1);
          p.set(part.x - (Math.cos(heading) * trail) / 2, part.y - (Math.sin(heading) * trail) / 2, SPRITE_Z);
        } else {
          const grow = 1 + (1 - t) * (BURST_MAX_GROWTH - 1);
          q.setFromAxisAngle(zAxis, part.rotation);
          s.setScalar(part.size * grow * 2);
          p.set(part.x, part.y, SPRITE_Z);
        }
        m.compose(p, q, s);
        sprites.setMatrixAt(spriteCount, m);
        // Additive: fading the colour fades the sprite.
        sprites.setColorAt(spriteCount, setColour(c, part.colour).multiplyScalar(Math.min(1, t * 1.8)));
        spriteCount++;
      }
      sprites.count = spriteCount;
      sprites.instanceMatrix.needsUpdate = true;
      sprites.instanceColor!.needsUpdate = true;

      shieldCount = 0;
      for (let i = 0; i < shields.length && shieldCount < MAX_SHIELDS; i++) {
        const sh = shields[i];
        if (sh === null) continue;
        m.compose(p.set(sh.x, sh.y, 0), q.identity(), s.setScalar(sh.radius));
        bubbles.setMatrixAt(shieldCount, m);
        bubbles.setColorAt(shieldCount, setColour(c, sh.colour).multiplyScalar(sh.alpha));
        shieldCount++;
      }
      bubbles.count = shieldCount;
      bubbles.instanceMatrix.needsUpdate = true;
      bubbles.instanceColor!.needsUpdate = true;
    },
    counts: () => ({ sprites: spriteCount, shields: shieldCount }),
    dispose() {
      sprites.geometry.dispose();
      bubbles.geometry.dispose();
      spriteMaterial.dispose();
      shieldMaterial.dispose();
      texture.dispose();
      sprites.dispose();
      bubbles.dispose();
      group.clear();
    },
  };
}
