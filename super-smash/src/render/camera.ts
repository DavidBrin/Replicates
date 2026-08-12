/**
 * The camera: framing, shake, and the magnifying glass.
 *
 * Smash's camera is one of the least-noticed and most load-bearing parts of the
 * game. It has to keep four fighters on screen without ever making any of them
 * too small to read, it has to move smoothly enough that nobody notices it
 * moving, and it has to communicate — a hit shakes it, a KO punches in on it.
 *
 * Everything in here is **cosmetic state**, held outside `GameState` on purpose
 * (SPEC §3). Rolling back eight frames must not replay eight frames of screen
 * shake, so trauma accumulates from `StepEvents` and decays on its own clock.
 * The consequence is that the camera is allowed to be frame-rate-dependent and
 * non-deterministic, and two peers may see very slightly different framing —
 * which is fine, and is the same trade the real game makes.
 */

import { toFloat } from "@/engine/fixed";
import type { GameState, StageDef, StepEvents } from "@/engine/types";

/** The renderer's fixed internal resolution. Everything else letterboxes. */
export const VIEW_WIDTH = 1920;
export const VIEW_HEIGHT = 1080;

/**
 * Zoom bounds, in screen pixels per simulation unit.
 *
 * The lower bound is set by the blast zone: Battlefield's is 480 units wide, and
 * 1920/480 = 4, so a camera that could pull back further than 4 would show
 * nothing but empty space beyond the KO line.
 *
 * The upper bound is readability. 15 px/unit puts a 13-unit fighter at 195px,
 * about a fifth of the screen height, which is roughly where Ultimate sits in a
 * close 1v1. It was 11, and at 11 a fighter is an eighth of the screen — small
 * enough that a forward smash's whole arm travel is a dozen pixels and every
 * attack in the game reads as "nothing happened".
 */
export const MIN_ZOOM = 3.6;
export const MAX_ZOOM = 15;

/**
 * How tall a fighter is, in simulation units.
 *
 * Not read from a rig: every fighter has a different one, and a graphic that
 * looked right on Donkey Kong and swallowed Pikachu would be the same bug in a
 * new place. The renderer sizes and frames against "a fighter" as a unit, and
 * this is it — one constant, here rather than in `vfx.ts`, because `vfx`
 * already imports from this module and the reverse would be a cycle.
 */
export const FIGHTER_UNITS = 13;

/** Empty space kept around the fighters, in simulation units. */
export const FRAME_MARGIN_X = 38;
export const FRAME_MARGIN_Y = 30;

export interface KoZoom {
  active: boolean;
  /** Frames remaining. */
  frames: number;
  x: number;
  y: number;
}

export interface Camera {
  /** Centre of the view, in simulation units. */
  x: number;
  y: number;
  /** Screen pixels per simulation unit. */
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
  /** 0..1. `shake = trauma²`. */
  trauma: number;
  shakeX: number;
  shakeY: number;
  shakeAngle: number;
  koZoom: KoZoom;
  /**
   * Slow-motion factor the game loop may apply during a KO. The camera never
   * applies it itself — the simulation's tick rate is not the camera's business.
   */
  timeScale: number;
  /** Cosmetic-only PRNG state for the shake offsets. */
  seed: number;
}

export function createCamera(stage?: StageDef | null): Camera {
  const centre = stage ? stageCentre(stage) : { x: 0, y: 0 };
  return {
    x: centre.x,
    y: centre.y,
    zoom: 6,
    targetX: centre.x,
    targetY: centre.y,
    targetZoom: 6,
    trauma: 0,
    shakeX: 0,
    shakeY: 0,
    shakeAngle: 0,
    koZoom: { active: false, frames: 0, x: 0, y: 0 },
    timeScale: 1,
    seed: 0x2545f491,
  };
}

function stageCentre(stage: StageDef): { x: number; y: number } {
  const b = stage.blastZone;
  return { x: (toFloat(b.left) + toFloat(b.right)) / 2, y: (toFloat(b.top) + toFloat(b.bottom)) / 2 };
}

/* -------------------------------------------------------------- framing -- */

export interface CameraTarget {
  x: number;
  y: number;
  zoom: number;
  /** True when at least one fighter was alive to frame. */
  framed: boolean;
}

/**
 * Where the camera wants to be: the bounding box of every live fighter, plus a
 * margin, fitted to the view.
 *
 * Dead fighters are excluded — a camera that kept framing a KO'd player would
 * pull all the way out to the blast zone every stock. Fighters on the respawn
 * platform *are* included, because the player is about to control them and
 * needs to see where they are coming down.
 */
export function cameraTarget(state: GameState, stage: StageDef): CameraTarget {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const f of state.fighters) {
    if (f.action === "dead") continue;
    const x = toFloat(f.x);
    const y = toFloat(f.y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    // A fighter's origin is at their feet, and a fighter is not a point — so a
    // box drawn round the origins alone sits entirely below the fighters in it.
    // Combined with the ground kept in shot below, that put the platform across
    // the middle of the screen and gave the lower half of every frame to the
    // stage's underside, while the fighters crowded the top.
    maxY = Math.max(maxY, y + FIGHTER_UNITS);
    count++;
  }

  const b = stage.blastZone;
  const centre = stageCentre(stage);
  if (count === 0) return { x: centre.x, y: centre.y, zoom: MIN_ZOOM, framed: false };

  // Keep the *middle* of the main platform in shot, so a close-up still has
  // ground and edges in it rather than being two fighters against the sky.
  //
  // A third of the half-width, not most of it: at 0.72 this floor was wider
  // than any two fighters ever get, so it — and not the fighters — set the zoom
  // for the whole match, and the camera never pushed in on anything. The stage
  // edges are allowed to leave the frame during close combat, exactly as they
  // do in the real game; `MIN_ZOOM` and the blast-zone clamp below are what
  // stop the view running off the stage entirely.
  const main = stage.platforms.find((p) => p.ledges) ?? stage.platforms[0];
  if (main) {
    minX = Math.min(minX, toFloat(main.x) - toFloat(main.halfWidth) * 0.32);
    maxX = Math.max(maxX, toFloat(main.x) + toFloat(main.halfWidth) * 0.32);
    minY = Math.min(minY, toFloat(main.y) - 6);
  }

  const width = maxX - minX + FRAME_MARGIN_X * 2;
  const height = maxY - minY + FRAME_MARGIN_Y * 2;
  const zoom = clamp(Math.min(VIEW_WIDTH / width, VIEW_HEIGHT / height), MIN_ZOOM, MAX_ZOOM);

  let x = (minX + maxX) / 2;
  let y = (minY + maxY) / 2;

  // Clamp so the view never shows past the blast zone. If the view is wider
  // than the blast zone the clamp is degenerate, so centre instead.
  const halfW = VIEW_WIDTH / (2 * zoom);
  const halfH = VIEW_HEIGHT / (2 * zoom);
  const left = toFloat(b.left);
  const right = toFloat(b.right);
  const top = toFloat(b.top);
  const bottom = toFloat(b.bottom);
  x = right - left >= halfW * 2 ? clamp(x, left + halfW, right - halfW) : (left + right) / 2;
  y = top - bottom >= halfH * 2 ? clamp(y, bottom + halfH, top - halfH) : (top + bottom) / 2;

  return { x, y, zoom, framed: true };
}

/* -------------------------------------------------------------- updating -- */

/** Exponential smoothing factors, per 60Hz frame. */
const FOLLOW_POSITION = 0.11;
const FOLLOW_ZOOM_OUT = 0.14;
const FOLLOW_ZOOM_IN = 0.045;

const TRAUMA_DECAY = 0.022;
const MAX_SHAKE_PIXELS = 58;
const MAX_SHAKE_ROTATION = 0.022;

/** KO punch-in: frames, and how far past the framed zoom it pushes. */
const KO_ZOOM_FRAMES = 48;
const KO_ZOOM_FACTOR = 1.7;
const KO_TIME_SCALE = 0.35;

/**
 * Advance the camera one frame.
 *
 * Zoom eases out faster than it eases in on purpose. Pulling back late means a
 * fighter is briefly off-screen, which is a real loss of information; zooming in
 * late costs nothing but a slightly wide shot. Asymmetric smoothing is the
 * cheapest possible fix and it is what the real game does.
 */
export function updateCamera(
  cam: Camera,
  state: GameState,
  stage: StageDef,
  events: StepEvents | null,
): Camera {
  const target = cameraTarget(state, stage);
  cam.targetX = target.x;
  cam.targetY = target.y;
  cam.targetZoom = target.zoom;

  if (events) ingestCameraEvents(cam, state, events);

  if (cam.koZoom.active) {
    cam.koZoom.frames--;
    if (cam.koZoom.frames <= 0) {
      cam.koZoom.active = false;
      cam.timeScale = 1;
    } else {
      // Punch in on the killing blow and hold, then release.
      const t = cam.koZoom.frames / KO_ZOOM_FRAMES;
      const punch = Math.sin(Math.min(1, t) * Math.PI) ** 0.5;
      cam.targetX = lerp(target.x, cam.koZoom.x, punch * 0.85);
      cam.targetY = lerp(target.y, cam.koZoom.y, punch * 0.85);
      cam.targetZoom = clamp(target.zoom * (1 + (KO_ZOOM_FACTOR - 1) * punch), MIN_ZOOM, MAX_ZOOM * 1.6);
      cam.timeScale = lerp(1, KO_TIME_SCALE, punch);
    }
  }

  cam.x += (cam.targetX - cam.x) * FOLLOW_POSITION;
  cam.y += (cam.targetY - cam.y) * FOLLOW_POSITION;
  const zoomRate = cam.targetZoom < cam.zoom ? FOLLOW_ZOOM_OUT : FOLLOW_ZOOM_IN;
  cam.zoom += (cam.targetZoom - cam.zoom) * zoomRate;

  updateShake(cam);
  return cam;
}

function ingestCameraEvents(cam: Camera, state: GameState, events: StepEvents): void {
  for (const hit of events.hits) {
    // Knockback rather than damage: a jab that connects should barely register,
    // a kill move should rattle the screen.
    addTrauma(cam, clamp(toFloat(hit.knockback) / 220, 0.04, 0.55));
  }
  if (events.shieldHits.length > 0) addTrauma(cam, 0.05 * events.shieldHits.length);
  if (events.clanks.length > 0) addTrauma(cam, 0.08 * events.clanks.length);
  if (events.shieldBreaks.length > 0) addTrauma(cam, 0.5);

  for (const ko of events.kos) {
    addTrauma(cam, 0.7);
    const victim = state.fighters.find((f) => f.port === ko.port);
    // The dramatic punch-in is reserved for the hit that ends a stock run.
    // Firing it on every KO would make a four-stock match unwatchable.
    if (victim && victim.stocks <= 1) {
      cam.koZoom = { active: true, frames: KO_ZOOM_FRAMES, x: toFloat(ko.x), y: toFloat(ko.y) };
    }
  }
}

/**
 * Accumulate shake.
 *
 * `shake = trauma²` rather than `shake = trauma` because a linear falloff spends
 * most of its life in a visible low-amplitude wobble that reads as a rendering
 * fault; squaring collapses the tail so the shake is violent and then simply
 * over. This is Squirrel Eiserloh's formulation and it is a genuinely large
 * difference for one multiplication.
 */
export function addTrauma(cam: Camera, amount: number): void {
  cam.trauma = clamp(cam.trauma + amount, 0, 1);
}

function updateShake(cam: Camera): void {
  cam.trauma = Math.max(0, cam.trauma - TRAUMA_DECAY);
  const shake = cam.trauma * cam.trauma;
  if (shake <= 0) {
    cam.shakeX = 0;
    cam.shakeY = 0;
    cam.shakeAngle = 0;
    return;
  }
  cam.shakeX = (nextNoise(cam) * 2 - 1) * MAX_SHAKE_PIXELS * shake;
  cam.shakeY = (nextNoise(cam) * 2 - 1) * MAX_SHAKE_PIXELS * shake;
  cam.shakeAngle = (nextNoise(cam) * 2 - 1) * MAX_SHAKE_ROTATION * shake;
}

function nextNoise(cam: Camera): number {
  let t = (cam.seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  cam.seed = t | 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------ projection -- */

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Simulation units to internal-resolution pixels.
 *
 * The world is y-up; the screen is y-down. This function is the only place that
 * flip happens outside `skeleton.resolve`.
 */
export function worldToScreen(cam: Camera, wx: number, wy: number): ScreenPoint {
  return {
    x: (wx - cam.x) * cam.zoom + VIEW_WIDTH / 2 + cam.shakeX,
    y: VIEW_HEIGHT / 2 - (wy - cam.y) * cam.zoom + cam.shakeY,
  };
}

export function screenToWorld(cam: Camera, sx: number, sy: number): ScreenPoint {
  return {
    x: (sx - VIEW_WIDTH / 2 - cam.shakeX) / cam.zoom + cam.x,
    y: cam.y - (sy - VIEW_HEIGHT / 2 - cam.shakeY) / cam.zoom,
  };
}

/** The visible rectangle in simulation units. */
export function visibleBounds(cam: Camera): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const halfW = VIEW_WIDTH / (2 * cam.zoom);
  const halfH = VIEW_HEIGHT / (2 * cam.zoom);
  return { left: cam.x - halfW, right: cam.x + halfW, top: cam.y + halfH, bottom: cam.y - halfH };
}

/** True when every live fighter is inside the view. The framing invariant. */
export function containsAllFighters(cam: Camera, state: GameState, pad = 0): boolean {
  const v = visibleBounds(cam);
  for (const f of state.fighters) {
    if (f.action === "dead") continue;
    const x = toFloat(f.x);
    const y = toFloat(f.y);
    if (x < v.left - pad || x > v.right + pad || y < v.bottom - pad || y > v.top + pad) return false;
  }
  return true;
}

/* ------------------------------------------------- magnifying-glass HUD -- */

export interface OffscreenIndicator {
  readonly port: number;
  /** Clamped position on the screen edge, internal-resolution pixels. */
  readonly x: number;
  readonly y: number;
  /** Direction from the screen centre to the fighter, radians (screen space). */
  readonly angle: number;
  /** 1 just off screen, shrinking to ~0.5 at the blast zone. */
  readonly scale: number;
  /** How far off screen, in simulation units — drives the damage warning. */
  readonly distance: number;
}

/** Inset of the indicator ring from the screen edge, in pixels. */
export const INDICATOR_INSET = 92;

/**
 * Ultimate's magnifying glass: a fighter past the edge of the view but still
 * inside the blast zone is drawn small at the screen edge, with an arrow
 * pointing at them.
 *
 * Not a nicety. A fighter launched off the top is often the only thing the
 * owning player can see about their own position, and without it recovering is
 * guesswork. The one place it is deliberately suppressed is a fighter already
 * past the blast zone: they are KO'd, and an indicator for a dead player is
 * noise.
 */
export function offscreenIndicators(
  cam: Camera,
  state: GameState,
  stage: StageDef,
): OffscreenIndicator[] {
  const out: OffscreenIndicator[] = [];
  const v = visibleBounds(cam);
  const b = stage.blastZone;
  const bl = toFloat(b.left);
  const br = toFloat(b.right);
  const bt = toFloat(b.top);
  const bb = toFloat(b.bottom);

  for (const f of state.fighters) {
    if (f.action === "dead" || f.stocks <= 0) continue;
    const x = toFloat(f.x);
    const y = toFloat(f.y);
    const inside = x >= v.left && x <= v.right && y >= v.bottom && y <= v.top;
    if (inside) continue;
    if (x < bl || x > br || y > bt || y < bb) continue;

    const dxUnits = x - cam.x;
    const dyUnits = y - cam.y;
    // Screen space: y flips.
    const sx = dxUnits * cam.zoom;
    const sy = -dyUnits * cam.zoom;
    const angle = Math.atan2(sy, sx);

    // Push the point out to the edge rectangle along its own direction.
    const halfW = VIEW_WIDTH / 2 - INDICATOR_INSET;
    const halfH = VIEW_HEIGHT / 2 - INDICATOR_INSET;
    const k = Math.min(
      Math.abs(sx) > 1e-6 ? halfW / Math.abs(sx) : Infinity,
      Math.abs(sy) > 1e-6 ? halfH / Math.abs(sy) : Infinity,
    );
    const ex = Number.isFinite(k) ? sx * k : 0;
    const ey = Number.isFinite(k) ? sy * k : 0;

    const overshoot = Math.max(
      x < v.left ? v.left - x : x > v.right ? x - v.right : 0,
      y < v.bottom ? v.bottom - y : y > v.top ? y - v.top : 0,
    );
    out.push({
      port: f.port,
      x: VIEW_WIDTH / 2 + ex,
      y: VIEW_HEIGHT / 2 + ey,
      angle,
      scale: clamp(1 - overshoot / 220, 0.45, 1),
      distance: overshoot,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- maths -- */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
