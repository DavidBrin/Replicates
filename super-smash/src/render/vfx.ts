/**
 * Particles, flashes and the rest of the cosmetic layer.
 *
 * **Fed by `StepEvents`, never by `GameState`.** That is the whole architectural
 * point of this file and it is worth stating plainly: rollback re-simulates up
 * to eight frames whenever a predicted input turns out to be wrong, and if the
 * VFX layer derived itself from state it would replay eight frames of explosions
 * every time the network hiccupped. Events are emitted once, by the authoritative
 * step, so a hit spark is spawned once no matter how many times the frame that
 * produced it is re-run. See SPEC §3.
 *
 * The exceptions are the things that are *continuous properties of a state*
 * rather than *reactions to a moment*: the shield bubble's radius follows shield
 * HP, the smash-charge glow follows `charge`, the Smash Ball's aura follows the
 * ball. Those are read from state each frame because they have no "moment" to
 * spawn on, and re-deriving them after a rollback is correct rather than
 * duplicative.
 */

import { toFloat } from "@/engine/fixed";
import { SHIELD_MAX_HEALTH, SHIELD_RELEASE_FRAMES, PERFECT_SHIELD_WINDOW } from "@/engine/constants";
import type { FighterState, GameState, StepEvents } from "@/engine/types";
import { createPoseBlends, type PoseBlend } from "./blend";
import { PORT_COLOURS, mixHex, withAlpha } from "./characterArt";
import { worldToScreen, type Camera } from "./camera";

export type ParticleKind =
  | "spark"
  | "burst"
  | "clank"
  | "shieldSpark"
  | "dust"
  | "chargeMote"
  | "afterimage"
  | "star"
  | "smoke"
  | "ring";

export interface Particle {
  kind: ParticleKind;
  /** Simulation units. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Frames remaining, and the value it started at. */
  life: number;
  maxLife: number;
  size: number;
  colour: string;
  rotation: number;
  spin: number;
  gravity: number;
  drag: number;
}

export interface StarKo {
  /** Simulation units. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  port: number;
}

export interface ScreenKo {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  port: number;
}

export interface Afterimage {
  x: number;
  y: number;
  facing: number;
  port: number;
  life: number;
  maxLife: number;
}

export interface VfxState {
  particles: Particle[];
  starKos: StarKo[];
  screenKos: ScreenKo[];
  afterimages: Afterimage[];
  /** Frames of white flash remaining, per port. */
  hitFlash: number[];
  /** Frames of perfect-shield flash remaining, per port. */
  parryFlash: number[];
  /** Full-screen KO flash, frames remaining. */
  koFlash: number;
  koFlashMax: number;
  /**
   * Where each fighter is in a cross-fade between two clips, by port.
   *
   * Cosmetic state that has to persist across frames, which is what this whole
   * object is for (D4) — it is not a particle, but it belongs to exactly the
   * same lifetime and travels to exactly the same places.
   */
  poseBlend: PoseBlend[];
  seed: number;
  frame: number;
}

/** A hit victim flashes white for two to four frames, scaled by damage. */
export const HIT_FLASH_FRAMES = 4;

/** How far a burst star swells before it dies. */
export const BURST_MAX_GROWTH = 1.7;
const MAX_PARTICLES = 640;

export function createVfx(): VfxState {
  return {
    particles: [],
    starKos: [],
    screenKos: [],
    afterimages: [],
    hitFlash: [0, 0, 0, 0],
    parryFlash: [0, 0, 0, 0],
    koFlash: 0,
    koFlashMax: 1,
    poseBlend: createPoseBlends(),
    seed: 0x9e3779b9,
    frame: 0,
  };
}

function rand(v: VfxState): number {
  let t = (v.seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  v.seed = t | 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function spread(v: VfxState, magnitude: number): number {
  return (rand(v) * 2 - 1) * magnitude;
}

function push(v: VfxState, p: Particle): void {
  // A hard cap rather than an unbounded array: a four-player match at 300% can
  // produce a lot of sparks, and dropping the oldest is invisible where a
  // stuttering frame is not.
  if (v.particles.length >= MAX_PARTICLES) v.particles.shift();
  v.particles.push(p);
}

/* -------------------------------------------------------------- ingestion -- */

/**
 * Turn one frame of events into particles.
 *
 * `state` is passed only for context the events do not carry — which port owns
 * a shield that was just hit, whether that shield was in its release window
 * (Ultimate's perfect shield is on *release*, SPEC §4), how many stocks a KO'd
 * fighter had left. None of it is re-simulated.
 */
export function ingestEvents(v: VfxState, events: StepEvents, state: GameState): void {
  for (const hit of events.hits) {
    const x = toFloat(hit.x);
    const y = toFloat(hit.y);
    const damage = toFloat(hit.damage);
    const kb = toFloat(hit.knockback);
    spawnHitSpark(v, x, y, damage, kb, (toFloat(hit.angle) * Math.PI) / 180);
    v.hitFlash[hit.victim] = Math.min(HIT_FLASH_FRAMES, 2 + Math.floor(damage / 8));
  }

  for (const s of events.shieldHits) {
    const victim = state.fighters.find((f) => f.port === s.victim);
    const parried =
      victim !== undefined &&
      victim.action === "shieldRelease" &&
      victim.actionFrame <= PERFECT_SHIELD_WINDOW;
    spawnShieldHit(v, toFloat(s.x), toFloat(s.y), s.victim, parried);
    if (parried) v.parryFlash[s.victim] = 10;
  }

  for (const c of events.clanks) spawnClank(v, toFloat(c.x), toFloat(c.y));
  for (const j of events.jumps) spawnDust(v, toFloat(j.x), toFloat(j.y), 6, 0.6);
  for (const l of events.lands) spawnDust(v, toFloat(l.x), toFloat(l.y), 9, 0.9);

  for (const port of events.shieldBreaks) {
    const f = state.fighters.find((x) => x.port === port);
    if (f) spawnBurst(v, toFloat(f.x), toFloat(f.y) + 6, 22, "#BFE8FF", 2.2);
  }

  for (const ko of events.kos) {
    v.koFlash = ko.kind === "blast" ? 12 : 8;
    v.koFlashMax = v.koFlash;
    const x = toFloat(ko.x);
    const y = toFloat(ko.y);
    if (ko.kind === "star") {
      v.starKos.push({ x, y, vx: spread(v, 0.9), vy: 3.4, life: 90, maxLife: 90, port: ko.port });
    } else if (ko.kind === "screen") {
      v.screenKos.push({ x, y, life: 46, maxLife: 46, port: ko.port });
    } else {
      spawnBurst(v, x, y, 34, PORT_COLOURS[ko.port % 4], 3.2);
    }
  }

  if (events.smashBallBroken !== null) {
    spawnBurst(v, toFloat(state.smashBall.x), toFloat(state.smashBall.y), 46, "#FFE873", 3.6);
  }
  for (const port of events.finalSmashes) {
    const f = state.fighters.find((x) => x.port === port);
    if (f) spawnBurst(v, toFloat(f.x), toFloat(f.y) + 6, 40, "#FFFFFF", 3.0);
  }
}

/**
 * Hit sparks, sized and coloured by damage.
 *
 * The colour ramp is Ultimate's read at a glance: small hits throw white and
 * pale-yellow sparks, big ones throw orange and red. A player who has not
 * looked at the percent still knows roughly what just landed.
 *
 * ## On the sizes below
 *
 * Everything here is in simulation units, the same ones  counts — so the numbers are readable as fractions of a fighter, which
 * is the only scale that matters. The burst tops out at a little under four
 * units, so the biggest hit in the game throws a star about a third of a
 * fighter high.
 *
 * That is deliberate and it was not always so: the burst used to reach nine
 * units and grow to 2.8×, which is a star four times the height of the fighter
 * who threw it. On a big hit the spark covered both fighters, the platform and
 * most of the screen, so the one frame a player most needs to read — who got
 * hit, and which way they are going — was the one frame they could see least.
 * A hit spark is punctuation. It is not the sentence.
 */
export function spawnHitSpark(
  v: VfxState,
  x: number,
  y: number,
  damage: number,
  knockback: number,
  /**
   * The world direction the victim is being launched, in radians. Sparks fan
   * out around it rather than in a circle, so the frame of contact already says
   * which way the fighter is about to go — which is the single most useful
   * thing a player can learn from a hit, and a symmetric puff says none of it.
   */
  launchAngle = 0,
): void {
  const heat = Math.min(1, damage / 22);
  const count = Math.round(5 + heat * 11);
  const colour = heat < 0.4 ? mixHex("#FFFFFF", "#FFE873", heat / 0.4) : mixHex("#FFE873", "#FF5A21", (heat - 0.4) / 0.6);
  const speed = 0.7 + heat * 1.9 + Math.min(1.6, knockback / 140);
  // Six frames is a tenth of a second, which is where a hit spark should be:
  // long enough to register, short enough that the very next frame of the
  // fighter being launched is unobstructed.
  const life = 5 + Math.round(heat * 4);

  push(v, {
    kind: "burst",
    x,
    y,
    vx: 0,
    vy: 0,
    life,
    maxLife: life,
    size: 1.2 + heat * 2.4,
    colour,
    rotation: rand(v) * Math.PI,
    spin: 0,
    gravity: 0,
    drag: 1,
  });

  // A wide fan rather than a beam: a hit is messy, and sparks that all point
  // one way read as a laser. Two thirds of a right angle either side keeps the
  // launch legible while still looking like an impact.
  const fan = Math.PI * 0.36;
  for (let i = 0; i < count; i++) {
    const a = launchAngle + (rand(v) * 2 - 1) * fan;
    const s = speed * (0.35 + rand(v) * 0.9);
    push(v, {
      kind: "spark",
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 5 + Math.round(rand(v) * 6),
      maxLife: 11,
      size: 0.35 + heat * 0.75 + rand(v) * 0.35,
      colour,
      rotation: a,
      spin: 0,
      gravity: -0.035,
      drag: 0.9,
    });
  }
}

/**
 * The streak a launched fighter drags behind them.
 *
 * Knockback is the game's whole scoring system and it was invisible: a fighter
 * flew off in silence, at the same apparent speed whether the hit was a jab or
 * a kill move. The trail is what makes a launch *feel* like force — it is
 * emitted per frame from the fighter's own velocity, so it is longer and denser
 * the harder they were hit, without anything having to be told how hard that
 * was.
 *
 * Reuses the `spark` particle, which already draws itself stretched backwards
 * along its own velocity. Nothing new to draw; it is the same streak the impact
 * throws, laid down continuously by a body instead of once by a fist.
 */
export const LAUNCH_TRAIL_SPEED = 1.6;

export function trackLaunchTrails(v: VfxState, state: GameState): void {
  for (const f of state.fighters) {
    if (f.action !== "hitstun" && f.action !== "tumble" && f.action !== "thrown") continue;
    // Hitlag is the freeze *before* the launch. A trail during it would be a
    // streak coming off a fighter who has not moved yet.
    if (f.hitlag > 0) continue;

    const vx = toFloat(f.vx);
    const vy = toFloat(f.vy);
    const speed = Math.hypot(vx, vy);
    if (speed < LAUNCH_TRAIL_SPEED) continue;

    const colour = PORT_COLOURS[f.port % PORT_COLOURS.length];
    const heat = Math.min(1, (speed - LAUNCH_TRAIL_SPEED) / 5);
    // Two per frame, offset across the body, so the trail has width. One
    // reads as a thread; the fighter is a solid object.
    for (let i = 0; i < 2; i++) {
      push(v, {
        kind: "spark",
        x: toFloat(f.x) + spread(v, 1.6),
        y: toFloat(f.y) + 6 + spread(v, 3),
        vx: vx * 0.4,
        vy: vy * 0.4,
        life: 6,
        maxLife: 6,
        size: 0.6 + heat * 1.3,
        colour,
        rotation: 0,
        spin: 0,
        gravity: 0,
        drag: 1,
      });
    }
  }
}

/** The white bubble two clanking hitboxes make. */
export function spawnClank(v: VfxState, x: number, y: number): void {
  push(v, {
    kind: "clank",
    x,
    y,
    vx: 0,
    vy: 0,
    life: 14,
    maxLife: 14,
    size: 5.5,
    colour: "#FFFFFF",
    rotation: 0,
    spin: 0,
    gravity: 0,
    drag: 1,
  });
  for (let i = 0; i < 8; i++) {
    const a = rand(v) * Math.PI * 2;
    push(v, {
      kind: "spark",
      x,
      y,
      vx: Math.cos(a) * 1.2,
      vy: Math.sin(a) * 1.2,
      life: 12,
      maxLife: 12,
      size: 0.7,
      colour: "#FFFFFF",
      rotation: a,
      spin: 0,
      gravity: -0.02,
      drag: 0.88,
    });
  }
}

export function spawnShieldHit(
  v: VfxState,
  x: number,
  y: number,
  port: number,
  parried: boolean,
): void {
  const colour = parried ? "#FFFFFF" : PORT_COLOURS[port % 4];
  for (let i = 0; i < (parried ? 20 : 10); i++) {
    const a = rand(v) * Math.PI * 2;
    push(v, {
      kind: "shieldSpark",
      x,
      y,
      vx: Math.cos(a) * (parried ? 2.4 : 1.1),
      vy: Math.sin(a) * (parried ? 2.4 : 1.1),
      life: parried ? 18 : 12,
      maxLife: 18,
      size: parried ? 1.1 : 0.7,
      colour,
      rotation: a,
      spin: 0,
      gravity: 0,
      drag: 0.9,
    });
  }
}

/**
 * The puff of dust under a landing or a jump.
 *
 * `size` is a *world* radius — `drawParticles` multiplies it by the camera
 * zoom — so it has to be read against the fighter beside it, who is about
 * thirteen units tall. It shipped at 1.1–2.7, a disc up to five units across:
 * two-fifths of a fighter's height, opaque, nine of them at once, sitting
 * still for four hundred milliseconds. On screen that is not dust, it is
 * scenery, and it read as a bank of low cloud parked on the platform.
 *
 * A tenth of a fighter is the size of a puff at the feet. The rest is timing:
 * gone in a quarter of a second, and translucent from the first frame so it
 * never has a hard edge to mistake for a shape.
 */
export function spawnDust(
  v: VfxState,
  x: number,
  y: number,
  count: number,
  power: number,
  /**
   * Push the puff one way along the ground, in units per frame.
   *
   * A landing throws dust outwards evenly, but everything a fighter does to
   * *start* or *stop* moving throws it the other way from the travel — that
   * asymmetry is most of what makes a skid read as a skid rather than as a
   * fighter standing in a cloud.
   */
  bias = 0,
): void {
  for (let i = 0; i < count; i++) {
    push(v, {
      kind: "dust",
      x: x + spread(v, 1.2),
      y,
      vx: spread(v, 1.1) * power + bias,
      vy: rand(v) * 0.45 * power,
      life: 11 + Math.round(rand(v) * 5),
      maxLife: 16,
      size: 0.32 + rand(v) * 0.34,
      colour: "#E8E4DC",
      rotation: 0,
      spin: 0,
      gravity: -0.02,
      drag: 0.86,
    });
  }
}

export function spawnBurst(
  v: VfxState,
  x: number,
  y: number,
  count: number,
  colour: string,
  power: number,
): void {
  push(v, {
    kind: "ring",
    x,
    y,
    vx: 0,
    vy: 0,
    life: 20,
    maxLife: 20,
    size: 4,
    colour,
    rotation: 0,
    spin: 0,
    gravity: 0,
    drag: 1,
  });
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + spread(v, 0.2);
    const s = power * (0.5 + rand(v) * 0.8);
    push(v, {
      kind: "spark",
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 18 + Math.round(rand(v) * 18),
      maxLife: 36,
      size: 1.0 + rand(v) * 1.4,
      colour,
      rotation: a,
      spin: 0,
      gravity: -0.03,
      drag: 0.93,
    });
  }
}

/**
 * Dodge afterimages.
 *
 * Derived from the fighter's action rather than from an event, because a dodge
 * is a span and not a moment: the trail has to be laid down on every frame the
 * fighter is intangible, and there is no `dodgeFrame` event to hang it on.
 */
export function trackAfterimages(v: VfxState, state: GameState): void {
  for (const f of state.fighters) {
    const dodging =
      f.action === "roll" ||
      f.action === "spotDodge" ||
      f.action === "airDodge" ||
      f.action === "ledgeRoll";
    if (!dodging || f.intangible <= 0) continue;
    if (f.actionFrame % 2 !== 0) continue;
    v.afterimages.push({
      x: toFloat(f.x),
      y: toFloat(f.y),
      facing: f.facing,
      port: f.port,
      life: 12,
      maxLife: 12,
    });
  }
}

/** Frames between footfall puffs while running — half of the run cycle. */
export const RUN_STEP_INTERVAL = 10;

/**
 * What a fighter does to the floor.
 *
 * The simulation emits an event for exactly two of these — a grounded jump and
 * a landing — because those are the two the *engine* cares about. Every other
 * moment a fighter shoves against the ground is a span of an action state and
 * nothing announces it, so it is derived here the same way afterimages are.
 *
 * Which mattered more than it sounds. Ultimate's ground effects are how you
 * read weight and commitment at a glance: the midair jump has a white puff that
 * is the clearest "that jump is spent" signal in the game, a skid drags a
 * scrape behind it, and a dash kicks dust the opposite way from the travel.
 * Without them a fighter moves like a cursor — correct positions, no contact
 * with the floor they are supposedly pushing off.
 */
export function trackGroundFx(v: VfxState, state: GameState): void {
  for (const f of state.fighters) {
    const x = toFloat(f.x);
    const y = toFloat(f.y);
    const back = -f.facing;

    switch (f.action) {
      // The midair jump. `events.jumps` fires only for the grounded one,
      // because that is the only jump that leaves a floor.
      case "jump":
        if (f.actionFrame === 0 && f.jumpsUsed >= 2) {
          push(v, ring(x, y + 3, "#FFFFFF", 2.4, 14));
          spawnDust(v, x, y + 2, 7, 0.7);
        }
        break;

      // Out of a standstill: the dust goes backwards, hard.
      case "dashStart":
        if (f.actionFrame === 0) spawnDust(v, x, y, 8, 0.75, back * 0.9);
        break;

      // Into a standstill: four frames of scrape, thrown ahead of the heels
      // because the fighter is still sliding the way they were running.
      case "runBrake":
        spawnDust(v, x - f.facing * 0.6, y, 3, 0.5, -back * 0.7);
        break;

      case "run":
        if (f.actionFrame % RUN_STEP_INTERVAL === 0) spawnDust(v, x, y, 2, 0.4, back * 0.35);
        break;

      // A roll scuffs at both ends and is silent in the middle, where the
      // fighter is off their feet.
      case "roll":
      case "ledgeRoll":
        if (f.actionFrame === 0) spawnDust(v, x, y, 5, 0.6, back * 0.5);
        break;

      // Landing lag is a *heavier* landing than the one `events.lands` already
      // drew, so this is the difference rather than the whole puff.
      case "landingLag":
        if (f.actionFrame === 0) spawnDust(v, x, y, 8, 1.3);
        break;

      default:
        break;
    }
  }
}

function ring(x: number, y: number, colour: string, size: number, life: number): Particle {
  return {
    kind: "ring",
    x,
    y,
    vx: 0,
    vy: 0,
    life,
    maxLife: life,
    size,
    colour,
    rotation: 0,
    spin: 0,
    gravity: 0,
    drag: 1,
  };
}

/** Smash-charge motes, spiralling into the charging fighter. */
export function trackChargeGlow(v: VfxState, state: GameState): void {
  for (const f of state.fighters) {
    if (f.charge <= 0) continue;
    if (v.frame % 2 !== 0) continue;
    const a = rand(v) * Math.PI * 2;
    const r = 9 + rand(v) * 5;
    push(v, {
      kind: "chargeMote",
      x: toFloat(f.x) + Math.cos(a) * r,
      y: toFloat(f.y) + 6 + Math.sin(a) * r * 0.6,
      vx: -Math.cos(a) * 0.55,
      vy: -Math.sin(a) * 0.35,
      life: 16,
      maxLife: 16,
      size: 0.8 + rand(v) * 0.8,
      colour: mixHex("#FFE873", "#FF7A2A", Math.min(1, f.charge / 60)),
      rotation: 0,
      spin: 0,
      gravity: 0,
      drag: 1,
    });
  }
}

/** Smoke off a fighter over 120% — the HUD panel smokes too (`hud.ts`). */
export function trackDamageSmoke(v: VfxState, state: GameState): void {
  for (const f of state.fighters) {
    if (toFloat(f.damage) < 120 || f.action === "dead") continue;
    if ((v.frame + f.port * 7) % 9 !== 0) continue;
    push(v, {
      kind: "smoke",
      x: toFloat(f.x) + spread(v, 2),
      y: toFloat(f.y) + 8 + rand(v) * 3,
      vx: spread(v, 0.12),
      vy: 0.26 + rand(v) * 0.18,
      life: 30,
      maxLife: 30,
      size: 1.6 + rand(v) * 1.8,
      colour: "#3A3A44",
      rotation: 0,
      spin: 0,
      gravity: 0,
      drag: 0.99,
    });
  }
}

/* --------------------------------------------------------------- updating -- */

/**
 * Age everything by one frame.
 *
 * Written as an in-place compaction rather than `filter` because this runs 60
 * times a second with up to 640 particles and allocating a new array each frame
 * is exactly the kind of thing that shows up as a GC sawtooth in a game loop.
 */
export function updateVfx(v: VfxState): void {
  v.frame++;

  let w = 0;
  for (let i = 0; i < v.particles.length; i++) {
    const p = v.particles[i];
    p.life--;
    if (p.life <= 0) continue;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.rotation += p.spin;
    v.particles[w++] = p;
  }
  v.particles.length = w;

  w = 0;
  for (let i = 0; i < v.afterimages.length; i++) {
    const a = v.afterimages[i];
    a.life--;
    if (a.life <= 0) continue;
    v.afterimages[w++] = a;
  }
  v.afterimages.length = w;

  w = 0;
  for (let i = 0; i < v.starKos.length; i++) {
    const s = v.starKos[i];
    s.life--;
    if (s.life <= 0) continue;
    s.x += s.vx;
    s.y += s.vy;
    s.vy *= 1.02;
    v.starKos[w++] = s;
  }
  v.starKos.length = w;

  w = 0;
  for (let i = 0; i < v.screenKos.length; i++) {
    const s = v.screenKos[i];
    s.life--;
    if (s.life <= 0) continue;
    v.screenKos[w++] = s;
  }
  v.screenKos.length = w;

  for (let p = 0; p < v.hitFlash.length; p++) {
    if (v.hitFlash[p] > 0) v.hitFlash[p]--;
    if (v.parryFlash[p] > 0) v.parryFlash[p]--;
  }
  if (v.koFlash > 0) v.koFlash--;
}

/** One call the renderer makes each frame, in the right order. */
export function stepVfx(v: VfxState, events: StepEvents | null, state: GameState): void {
  if (events) ingestEvents(v, events, state);
  trackAfterimages(v, state);
  trackGroundFx(v, state);
  trackLaunchTrails(v, state);
  trackChargeGlow(v, state);
  trackDamageSmoke(v, state);
  updateVfx(v);
}

/* ---------------------------------------------------------------- drawing -- */

export function drawParticles(ctx: CanvasRenderingContext2D, v: VfxState, cam: Camera): void {
  ctx.save();
  ctx.lineCap = "butt";
  for (const p of v.particles) {
    const t = p.life / p.maxLife;
    const s = worldToScreen(cam, p.x, p.y);
    const r = p.size * cam.zoom;
    switch (p.kind) {
      case "spark": {
        // Stretched backwards along its own velocity: a streak reads as speed
        // where a dot reads as confetti. Screen y is flipped, hence the `+`.
        const speed = Math.hypot(p.vx, p.vy);
        const trail = Math.min(30, speed * cam.zoom * 2.2);
        const nx = speed > 1e-6 ? p.vx / speed : 0;
        const ny = speed > 1e-6 ? p.vy / speed : 0;
        ctx.strokeStyle = withAlpha(p.colour, Math.min(1, t * 1.6));
        ctx.lineWidth = Math.max(1, r * 0.7);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - nx * trail, s.y + ny * trail);
        ctx.stroke();
        break;
      }
      case "burst": {
        // A short pop rather than a bloom. The star was expanding to nearly
        // three times its spawn size, which on top of a size that was already
        // too large is what turned a hit into a screen wipe.
        const grow = 1 + (1 - t) * (BURST_MAX_GROWTH - 1);
        ctx.fillStyle = withAlpha(p.colour, Math.min(1, t * 1.9));
        star(ctx, s.x, s.y, r * grow, r * grow * 0.34, 4, p.rotation);
        ctx.fill();
        break;
      }
      case "clank": {
        const grow = 1 + (1 - t) * 1.4;
        ctx.strokeStyle = withAlpha("#FFFFFF", t);
        ctx.lineWidth = Math.max(2, r * 0.35);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * grow, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = withAlpha("#FFFFFF", t * 0.4);
        ctx.fill();
        break;
      }
      case "ring": {
        const grow = 1 + (1 - t) * 5;
        ctx.strokeStyle = withAlpha(p.colour, t * 0.85);
        ctx.lineWidth = Math.max(2, r * 0.5 * t);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * grow, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "smoke": {
        ctx.fillStyle = withAlpha(p.colour, t * 0.32);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * (1.6 - t * 0.6), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "dust": {
        // Spreads as it thins. Alpha falls off with the square of the life
        // left, so the puff is faint for most of the time it is on screen —
        // a dust cloud that holds its opacity reads as a painted object.
        const spreadOut = 1 + (1 - t) * 1.1;
        ctx.fillStyle = withAlpha(p.colour, t * t * 0.55);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * spreadOut, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        ctx.fillStyle = withAlpha(p.colour, Math.min(1, t * 1.4));
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  rotation: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i / (points * 2)) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * The shield bubble.
 *
 * Radius follows shield HP, which is the mechanic made visible: a shield that
 * has been whittled to a quarter is visibly a quarter the size, and the fighter
 * is visibly poking out of it. Perfect shield flashes white — and it flashes on
 * *release*, matching Ultimate's rule rather than Smash 4's.
 */
export function drawShield(
  ctx: CanvasRenderingContext2D,
  v: VfxState,
  fighter: FighterState,
  cam: Camera,
  fighterHeight: number,
): void {
  const shielding =
    fighter.action === "shieldStart" ||
    fighter.action === "shield" ||
    fighter.action === "shieldStun" ||
    fighter.action === "shieldRelease";
  if (!shielding) return;

  const hp = Math.max(0, toFloat(fighter.shieldHealth)) / toFloat(SHIELD_MAX_HEALTH);
  const s = worldToScreen(cam, toFloat(fighter.x), toFloat(fighter.y) + fighterHeight * 0.5);
  const base = fighterHeight * 0.92 * cam.zoom;
  const radius = base * (0.5 + 0.5 * Math.max(0, Math.min(1, hp)));

  let alpha = 0.42;
  let colour = PORT_COLOURS[fighter.port % 4];
  if (fighter.action === "shieldStart") alpha *= Math.min(1, fighter.actionFrame / 3 + 0.35);
  if (fighter.action === "shieldRelease") {
    alpha *= Math.max(0, 1 - fighter.actionFrame / SHIELD_RELEASE_FRAMES);
  }
  const parry = v.parryFlash[fighter.port] ?? 0;
  if (parry > 0) {
    colour = "#FFFFFF";
    alpha = 0.35 + (parry / 10) * 0.6;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(colour, alpha * 0.55);
  ctx.fill();
  ctx.strokeStyle = withAlpha(colour, Math.min(1, alpha * 2));
  ctx.lineWidth = Math.max(2, radius * 0.09);
  ctx.lineCap = "square";
  ctx.stroke();
  ctx.restore();
}

/* ----------------------------------------------------------- projectiles -- */

/**
 * Projectiles, drawn from `ProjectileDef.visual`.
 *
 * The `visual` field is the engine handing the renderer a drawing hint rather
 * than the renderer inferring one from `defId`, which matters because three of
 * the eight fighters are defined by their projectiles and the ids belong to
 * `fighters/`. Seven shapes cover the whole roster, and an unknown hint falls
 * back to "energy" instead of drawing nothing — a projectile you cannot see is
 * a projectile you cannot dodge.
 *
 * Rotation comes from the projectile's own velocity, so an arrow noses over as
 * it falls and a bomb tumbles, without either needing a per-frame angle in the
 * simulation state.
 */
export function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  visualFor: (defId: string) => ProjectileVisual,
): void {
  if (!state.projectiles || state.projectiles.length === 0) return;
  ctx.save();
  for (const p of state.projectiles) {
    const s = worldToScreen(cam, toFloat(p.x), toFloat(p.y));
    const vx = toFloat(p.vx);
    const vy = toFloat(p.vy);
    // Screen space: y is flipped, so the heading negates vy.
    const heading = Math.atan2(-vy, vx);
    const scale = cam.zoom;
    const charge = Math.max(1, toFloat(p.chargeScale));

    ctx.save();
    ctx.translate(s.x, s.y);
    switch (visualFor(p.defId)) {
      case "arrow":
        ctx.rotate(heading);
        paintArrow(ctx, scale, p.facing);
        break;
      case "bomb":
        // Tumbles on its own clock rather than following its heading.
        ctx.rotate(p.age * 0.14 * (p.facing >= 0 ? 1 : -1));
        paintBomb(ctx, scale);
        break;
      case "boomerang":
        ctx.rotate(p.age * 0.42 * (p.returning ? -1 : 1));
        paintBoomerang(ctx, scale);
        break;
      case "fire":
        paintFire(ctx, scale, state.frame + p.instanceId * 7);
        break;
      case "spark":
        paintSpark(ctx, scale, state.frame + p.instanceId * 11);
        break;
      case "missile":
        ctx.rotate(heading);
        paintMissile(ctx, scale, state.frame);
        break;
      default:
        paintEnergy(ctx, scale, charge);
    }
    ctx.restore();
  }
  ctx.restore();
}

export type ProjectileVisual = "arrow" | "bomb" | "boomerang" | "energy" | "fire" | "spark" | "missile";

function paintArrow(ctx: CanvasRenderingContext2D, k: number, facing: number): void {
  ctx.scale(facing >= 0 ? 1 : 1, 1);
  ctx.fillStyle = "#C7A24A";
  ctx.fillRect(-2.6 * k, -0.22 * k, 4.4 * k, 0.44 * k);
  ctx.beginPath();
  ctx.moveTo(2.6 * k, 0);
  ctx.lineTo(1.2 * k, -0.7 * k);
  ctx.lineTo(1.2 * k, 0.7 * k);
  ctx.closePath();
  ctx.fillStyle = "#E4EAF0";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2.6 * k, 0);
  ctx.lineTo(-1.6 * k, -0.8 * k);
  ctx.lineTo(-1.2 * k, 0);
  ctx.lineTo(-1.6 * k, 0.8 * k);
  ctx.closePath();
  ctx.fillStyle = "#D8524A";
  ctx.fill();
}

function paintBomb(ctx: CanvasRenderingContext2D, k: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, 1.5 * k, 0, Math.PI * 2);
  ctx.fillStyle = "#2B3A4A";
  ctx.fill();
  ctx.strokeStyle = "#8FA8C0";
  ctx.lineWidth = Math.max(1.5, 0.22 * k);
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-0.5 * k, -0.5 * k, 0.42 * k, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();
}

function paintBoomerang(ctx: CanvasRenderingContext2D, k: number): void {
  ctx.beginPath();
  ctx.moveTo(-1.6 * k, -0.4 * k);
  ctx.lineTo(0.2 * k, -1.6 * k);
  ctx.lineTo(0.9 * k, -0.8 * k);
  ctx.lineTo(0.1 * k, 0.1 * k);
  ctx.lineTo(0.9 * k, 0.9 * k);
  ctx.lineTo(0.1 * k, 1.6 * k);
  ctx.closePath();
  ctx.fillStyle = "#B8862E";
  ctx.fill();
  ctx.strokeStyle = "#5A3E12";
  ctx.lineWidth = Math.max(1.5, 0.18 * k);
  ctx.lineCap = "butt";
  ctx.stroke();
}

function paintEnergy(ctx: CanvasRenderingContext2D, k: number, charge: number): void {
  const r = 1.5 * k * Math.min(2.2, charge);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, "rgba(255,255,255,0.98)");
  g.addColorStop(0.45, "rgba(255,214,110,0.9)");
  g.addColorStop(1, "rgba(255,120,40,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

function paintFire(ctx: CanvasRenderingContext2D, k: number, phase: number): void {
  const flicker = 1 + 0.16 * Math.sin(phase / 3);
  const r = 1.6 * k * flicker;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, "rgba(255,246,214,0.98)");
  g.addColorStop(0.4, "rgba(255,150,40,0.92)");
  g.addColorStop(1, "rgba(200,40,20,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

function paintSpark(ctx: CanvasRenderingContext2D, k: number, phase: number): void {
  ctx.strokeStyle = "#FFE873";
  ctx.lineWidth = Math.max(2, 0.3 * k);
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(-1.6 * k, 0);
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    ctx.lineTo(-1.6 * k + 3.2 * k * t, Math.sin(phase * 0.4 + i * 1.9) * 0.7 * k);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 0.7 * k, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,220,0.75)";
  ctx.fill();
}

function paintMissile(ctx: CanvasRenderingContext2D, k: number, frame: number): void {
  ctx.fillStyle = "#D8DEE6";
  ctx.beginPath();
  ctx.moveTo(1.8 * k, 0);
  ctx.lineTo(0.2 * k, -0.7 * k);
  ctx.lineTo(-1.4 * k, -0.6 * k);
  ctx.lineTo(-1.4 * k, 0.6 * k);
  ctx.lineTo(0.2 * k, 0.7 * k);
  ctx.closePath();
  ctx.fill();
  const flame = 1 + 0.3 * Math.sin(frame / 2);
  const g = ctx.createRadialGradient(-1.6 * k, 0, 0, -1.6 * k, 0, 1.2 * k * flame);
  g.addColorStop(0, "rgba(255,236,180,0.95)");
  g.addColorStop(1, "rgba(255,90,30,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(-1.6 * k, 0, 1.2 * k * flame, 0, Math.PI * 2);
  ctx.fill();
}

/** The rainbow aura on a live Smash Ball, plus the ball itself. */
export function drawSmashBall(ctx: CanvasRenderingContext2D, state: GameState, cam: Camera): void {
  if (!state.smashBall.active) return;
  const s = worldToScreen(cam, toFloat(state.smashBall.x), toFloat(state.smashBall.y));
  const r = 7 * cam.zoom;
  const phase = (state.frame % 60) / 60;

  ctx.save();
  for (let i = 0; i < 6; i++) {
    const hue = ((i / 6 + phase) % 1) * 360;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * (1.35 + i * 0.16), (i / 6) * Math.PI * 2 + phase * 6.28, (i / 6) * Math.PI * 2 + phase * 6.28 + 1.1);
    ctx.strokeStyle = `hsla(${hue}, 95%, 62%, 0.55)`;
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.lineCap = "butt";
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  // The Smash Bros. crossed-lines emblem, reduced to its four spokes.
  ctx.strokeStyle = "#12151A";
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.lineCap = "square";
  for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    ctx.beginPath();
    ctx.moveTo(s.x - Math.cos(a) * r * 0.72, s.y - Math.sin(a) * r * 0.72);
    ctx.lineTo(s.x + Math.cos(a) * r * 0.72, s.y + Math.sin(a) * r * 0.72);
    ctx.stroke();
  }
  ctx.restore();
}

/** The Final Smash standby glow around a fighter holding the ball. */
export function drawFinalSmashAura(
  ctx: CanvasRenderingContext2D,
  fighter: FighterState,
  cam: Camera,
  fighterHeight: number,
  frame: number,
): void {
  if (fighter.finalSmashReady <= 0) return;
  const s = worldToScreen(cam, toFloat(fighter.x), toFloat(fighter.y) + fighterHeight * 0.5);
  const r = fighterHeight * cam.zoom * 0.85;
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const hue = (((i / 5 + (frame % 40) / 40) % 1) * 360) | 0;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * (0.8 + i * 0.11), 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.3)`;
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.lineCap = "square";
    ctx.stroke();
  }
  ctx.restore();
}

/** The full-screen white flash on a blast-zone KO. */
export function drawKoFlash(ctx: CanvasRenderingContext2D, v: VfxState): void {
  if (v.koFlash <= 0) return;
  const t = v.koFlash / Math.max(1, v.koFlashMax);
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${(t * 0.72).toFixed(3)})`;
  ctx.fillRect(0, 0, 1920, 1080);
  ctx.restore();
}

/**
 * Star KO: the fighter shrinks into a receding star.
 *
 * Drawn in *world* space and allowed to leave the blast zone, because the point
 * of a star KO is watching someone disappear into the sky — clipping it at the
 * KO line would cut the joke.
 */
export function drawStarKos(ctx: CanvasRenderingContext2D, v: VfxState, cam: Camera): void {
  ctx.save();
  for (const s of v.starKos) {
    const t = s.life / s.maxLife;
    const p = worldToScreen(cam, s.x, s.y);
    const size = Math.max(2, 26 * t * t);
    ctx.fillStyle = withAlpha(PORT_COLOURS[s.port % 4], Math.min(1, t * 1.4));
    star(ctx, p.x, p.y, size, size * 0.42, 5, (1 - t) * 8);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${(t * 0.8).toFixed(3)})`;
    star(ctx, p.x, p.y, size * 0.55, size * 0.22, 5, (1 - t) * 8);
    ctx.fill();
  }
  ctx.restore();
}

/** Screen KO: the fighter hits the camera and slides down it. */
export function drawScreenKos(ctx: CanvasRenderingContext2D, v: VfxState): void {
  ctx.save();
  for (const s of v.screenKos) {
    const t = s.life / s.maxLife;
    const cx = 1920 / 2;
    const cy = 1080 / 2 - 60 + (1 - t) * 240;
    const r = 150 + (1 - t) * 40;
    ctx.globalAlpha = Math.min(1, t * 1.5);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fill();
    // Cracks, radiating from the impact.
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 4;
    ctx.lineCap = "square";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + s.port;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r * (0.6 + ((i * 37) % 40) / 100), cy + Math.sin(a) * r * (0.6 + ((i * 53) % 40) / 100));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** How white to paint a fighter this frame, 0..1. */
export function hitFlashAmount(v: VfxState, port: number): number {
  const f = v.hitFlash[port] ?? 0;
  return f <= 0 ? 0 : Math.min(1, f / HIT_FLASH_FRAMES) * 0.85;
}
