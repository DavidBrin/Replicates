/**
 * The composition root: everything the match draws, in order, once a frame.
 *
 * ## Fixed internal resolution
 *
 * The whole frame is composed at **1920×1080 regardless of the canvas** and
 * letterboxed into whatever it is given. Every position, font size and stroke
 * width in `render/` is therefore a constant rather than a fraction of the
 * viewport, the HUD is laid out once instead of at every breakpoint, and a
 * 1366×768 laptop and a 4K monitor see identical framing rather than one of
 * them seeing more of the stage than the other — which in a versus game is a
 * competitive difference, not a cosmetic one.
 *
 * ## Interpolation
 *
 * The simulation is locked to 60Hz (SPEC §3) and must stay there: it is a pure
 * integer function and rollback depends on the tick being the unit of time. But
 * a 144Hz display refreshes 2.4 times per simulation frame, and drawing the same
 * position twice then jumping reads as judder. So `render` takes the previous
 * and current states and an `alpha`, and interpolates *positions only* — action
 * state, frame counters and hitboxes are discrete and are taken from the current
 * state untouched. Nothing interpolated is ever fed back into the simulation.
 *
 * ## An overlay on the 3D world
 *
 * The world itself — the stage, the fighters, their shields and sparks — is the
 * 3D layer's (`render3d/`, Plan 4), drawn under this canvas, and the stage's sky
 * is `renderBackground`'s, under that. This canvas is cleared every frame and
 * carries everything else: the HUD, port tags, move effects, projectiles, the
 * other particles, the KO flashes and the magnifying glass (D57).
 */

import { toFloat } from "@/engine/fixed";
import type { FighterDef, FighterState, GameState, StageDef, StepEvents } from "@/engine/types";
import {
  INDICATOR_INSET,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  offscreenIndicators,
  worldToScreen,
  type Camera,
} from "./camera";
import {
  PORT_COLOURS,
  drawPortTag,
  drawStockIcon,
  getCharacterRig,
  hitlagShake,
  withAlpha,
  type CharacterRig,
} from "./characterArt";
import { drawHud, updateHud, type HudFighterInfo, type HudState } from "./hud";
import { jumpTimingFor, moveTimingFor, poseNameFor, poseSpinFor, samplePoseForFighter } from "./poses";
import { blendedPose, clipFrameFor } from "./blend";
import { rigHeight } from "./skeleton";
import { drawBackground, drawBlastZone } from "./stageArt";
import { drawMoveFx } from "./specialFx";
import { projectilePainterFor } from "./chars";
import {
  drawFinalSmashAura,
  drawKoFlash,
  drawParticles,
  drawProjectiles,
  type ProjectileLook,
  drawScreenKos,
  drawDizzyStars,
  drawSmashBall,
  drawStarKos,
  type ParticleKind,
  type VfxState,
} from "./vfx";

export const INTERNAL_WIDTH = VIEW_WIDTH;
export const INTERNAL_HEIGHT = VIEW_HEIGHT;

/**
 * Everything one frame needs to draw itself.
 *
 * Bundled into the `state` parameter rather than spread across more arguments
 * so `render` keeps the shape the architecture calls for —
 * `render(ctx, state, events, camera, alpha)`. `previous` has to be in here
 * somewhere: interpolation is meaningless without it, and the game loop is the
 * only thing that knows which two states are adjacent.
 */
export interface RenderState {
  readonly current: GameState;
  /** The state one simulation frame earlier. `null` on the first frame. */
  readonly previous: GameState | null;
  readonly stage: StageDef;
  /** Fighter definitions indexed by port. `null` where one is not loaded yet. */
  readonly fighters: readonly (FighterDef | null)[];
  /** Display names, indexed by port. Falls back to the fighter's own name. */
  readonly labels?: readonly string[];
  readonly cpu?: readonly boolean[];
  readonly vfx: VfxState;
  readonly hud: HudState;
  readonly showBlastZone?: boolean;
  /**
   * Per port, where the 3D model's head is this frame (`render3d/anchors.ts`,
   * from the same baked head bone `Fighter3D` draws). Port tags, move effects,
   * dizzy stars and the Final Smash aura hang off it — SSBU-sized DK is twice
   * his 2D rig. A fighter with none (no bake) falls back to the 2D rig's height.
   */
  readonly anchors?: readonly (OverlayAnchor | null)[];
}

/** A fighter's head in the 3D world, relative to their feet, in world units. */
export interface OverlayAnchor {
  /** Forward of the feet, already signed by facing. */
  readonly headX: number;
  /** Top of the head hurt capsule above the feet. */
  readonly headTop: number;
}

/** What the overlay learned while drawing that the 3D layer needs this frame. */
export interface OverlayResult {
  /** `hidden[port]`: a move effect replaces the fighter (Kirby's Stone). */
  readonly hidden: boolean[];
}

/** Particle kinds the 3D layer draws (`render3d/vfx3d.ts` SPRITE_KINDS, repeated so render/ never imports three). */
export const WORLD3D_PARTICLES: ReadonlySet<ParticleKind> = new Set<ParticleKind>(["spark", "burst"]);

/* ------------------------------------------------------------ letterboxing -- */

export interface Letterbox {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export function computeLetterbox(canvasWidth: number, canvasHeight: number): Letterbox {
  const scale = Math.min(canvasWidth / INTERNAL_WIDTH, canvasHeight / INTERNAL_HEIGHT);
  const width = INTERNAL_WIDTH * scale;
  const height = INTERNAL_HEIGHT * scale;
  return {
    scale,
    offsetX: (canvasWidth - width) / 2,
    offsetY: (canvasHeight - height) / 2,
    width,
    height,
  };
}

/* --------------------------------------------------------- interpolation -- */

/** A fighter's drawn position: current state, previous position, blended. */
export interface DrawnFighter {
  readonly fighter: FighterState;
  readonly x: number;
  readonly y: number;
  readonly def: FighterDef | null;
  readonly rig: CharacterRig;
}

/**
 * Beyond this many units of movement in one frame, snap instead of blending.
 *
 * A respawn, a teleport recovery or a stage transition moves a fighter further
 * in one frame than any running speed can, and interpolating across it draws
 * the fighter streaking across the stage. Fox's run speed is around 2.5 units a
 * frame, so 24 is an order of magnitude clear of anything legitimate.
 */
export const INTERPOLATION_SNAP_UNITS = 24;

export function interpolatePosition(
  previous: FighterState | undefined,
  current: FighterState,
  alpha: number,
): { x: number; y: number } {
  const cx = toFloat(current.x);
  const cy = toFloat(current.y);
  if (!previous) return { x: cx, y: cy };
  const px = toFloat(previous.x);
  const py = toFloat(previous.y);
  if (Math.abs(cx - px) > INTERPOLATION_SNAP_UNITS || Math.abs(cy - py) > INTERPOLATION_SNAP_UNITS) {
    return { x: cx, y: cy };
  }
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return { x: px + (cx - px) * t, y: py + (cy - py) * t };
}

/* ----------------------------------------------------------------- render -- */

/**
 * Draw one frame of the overlay.
 *
 * The canvas is cleared, not filled, so the 3D layer under it shows through.
 * Order is load-bearing and is exactly: each fighter's move effects, aura,
 * dizzy stars and port tag, then projectiles, the Smash Ball, particles, the
 * HUD and the magnifying-glass indicators. Projectiles and the ball after the
 * fighters' furniture so a contested Smash Ball is never hidden behind a tag;
 * the HUD above all of it; the indicators last because they are the one thing
 * that must never be occluded.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  events: StepEvents | null,
  camera: Camera,
  interpolationAlpha: number,
): OverlayResult {
  const canvas = ctx.canvas;
  const box = computeLetterbox(canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // The 3D layer shows through; the overlay only adds to it.
  ctx.clearRect(0, 0, canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);

  ctx.translate(box.offsetX, box.offsetY);
  ctx.scale(box.scale, box.scale);
  ctx.beginPath();
  ctx.rect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
  ctx.clip();

  const result = drawScene(ctx, state, events, camera, interpolationAlpha);

  ctx.restore();
  return result;
}

/**
 * The background canvas under the 3D layer: the stage's parallax sky, letterboxed
 * like everything else, with the bars painted black.
 */
export function renderBackground(ctx: CanvasRenderingContext2D, stage: StageDef, camera: Camera, frame: number): void {
  const canvas = ctx.canvas;
  const box = computeLetterbox(canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);
  ctx.translate(box.offsetX, box.offsetY);
  ctx.scale(box.scale, box.scale);
  drawBackground(ctx, stage, camera, frame);
  ctx.restore();
}

/** The 1920×1080 frame itself, with the letterbox transform already applied. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  events: StepEvents | null,
  camera: Camera,
  interpolationAlpha: number,
): OverlayResult {
  const game = state.current;
  const stage = state.stage;
  const hidden = game.fighters.map(() => false);

  if (state.showBlastZone) drawBlastZone(ctx, stage, camera);

  const drawn = state.current.fighters.map<DrawnFighter>((fighter) => {
    const previous = state.previous?.fighters.find((f) => f.port === fighter.port);
    const pos = interpolatePosition(previous, fighter, interpolationAlpha);
    const def = state.fighters[fighter.port] ?? null;
    return { fighter, x: pos.x, y: pos.y, def, rig: getCharacterRig(def?.id) };
  });

  // Whoever is doing something goes on top.
  //
  // Port order is the obvious draw order and it is the wrong one: it means the
  // player on port 1 spends every exchange hidden behind whoever is on port 2,
  // and against a body as wide as Donkey Kong's, "hidden" is literal — a
  // forward smash landing squarely was invisible because the fighter throwing
  // it was entirely behind the fighter taking it. Sorting by what each fighter
  // is doing keeps the attacker's effects over the launch's, and it is stable,
  // so two idle fighters do not swap depth every time one of them twitches.
  for (const d of [...drawn].sort((a, b) => drawDepth(a.fighter) - drawDepth(b.fighter))) {
    if (d.fighter.action === "dead") continue;
    hidden[d.fighter.port] = drawOneFighter(ctx, state, camera, d);
  }

  drawProjectiles(ctx, game, camera, projectileVisual(state));
  drawSmashBall(ctx, game, camera);
  // The sparks and bursts are the 3D layer's sprites; drawn here too, each would show twice.
  drawParticles(ctx, state.vfx, camera, WORLD3D_PARTICLES);
  drawStarKos(ctx, state.vfx, camera);
  drawKoFlash(ctx, state.vfx);
  drawScreenKos(ctx, state.vfx);

  updateHud(state.hud, game);
  drawHud(ctx, { state: game, info: hudInfo(state), hud: state.hud });

  drawIndicators(ctx, state, camera);
  return { hidden };
}

/**
 * Look up how a projectile should be drawn, from its definition id.
 *
 * `ProjectileState` carries only `defId`; both the shared `visual` hint and the
 * fighter who owns it live on the `ProjectileDef` inside whichever move
 * launches it. Rather than have `fighters/` publish a second index for the
 * renderer's benefit, this walks the loaded fighter definitions once and
 * memoises the result on the roster array — the roster does not change during a
 * match, so the walk happens once per match rather than once per frame.
 *
 * The owner is what lets a fighter paint their own: Mario's fireball and Fox's
 * blaster bolt are both `"energy"` to the engine, and a shared seven-shape
 * vocabulary is exactly as far as that gets you.
 */
const VISUAL_CACHE = new WeakMap<object, Map<string, ProjectileLook>>();

export function projectileVisual(state: RenderState): (defId: string) => ProjectileLook {
  const key = state.fighters as unknown as object;
  let index = VISUAL_CACHE.get(key);
  if (!index) {
    index = new Map<string, ProjectileLook>();
    for (const def of state.fighters) {
      if (!def) continue;
      for (const move of Object.values(def.moves)) {
        for (const projectile of move?.projectiles ?? []) {
          index.set(projectile.id, {
            visual: projectile.visual,
            paint: projectilePainterFor(def.id, projectile.id),
          });
        }
      }
    }
    VISUAL_CACHE.set(key, index);
  }
  const resolved = index;
  // An unknown id falls back to "energy" rather than drawing nothing — a
  // projectile you cannot see is a projectile you cannot dodge.
  return (defId: string) => resolved.get(defId) ?? FALLBACK_LOOK;
}

const FALLBACK_LOOK: ProjectileLook = { visual: "energy" };

function hudInfo(state: RenderState): HudFighterInfo[] {
  return state.current.fighters.map((f) => {
    const def = state.fighters[f.port] ?? null;
    return {
      def,
      label: state.labels?.[f.port] ?? def?.name ?? `P${f.port + 1}`,
      isCpu: state.cpu?.[f.port] ?? false,
    };
  });
}

/* -------------------------------------------------------------- a fighter -- */

/** Visual height of a rig in simulation units — feet to crown. */
export function visualHeight(rig: CharacterRig): number {
  return rigHeight(rig.bones, rig.headRadius) * rig.scale;
}

/**
 * Everything the overlay hangs on one fighter: their move's own effect, the
 * Final Smash aura, dizzy stars and the port tag. The fighter is the 3D
 * layer's (`Fighter3D`); this draws no figure, shield or port ring. Returns
 * whether the move effect replaces the fighter this frame (Kirby's Stone), for
 * the 3D layer to hide them.
 */
function drawOneFighter(ctx: CanvasRenderingContext2D, state: RenderState, cam: Camera, d: DrawnFighter): boolean {
  const f = d.fighter;
  const rig = d.rig;
  const timing = moveTimingFor(d.def, f.move);
  const frame = state.current.frame;
  const name = poseNameFor(f);
  // The clip's own root offset, which the 3D layer moves the model by too
  // (`rootXformInto`: the offset times the 2D rig's scale), so a move effect
  // stays on the body. Sampled on its own clock and faded out of whatever was
  // on screen last frame, as the model is; see `blend.ts` — `clipFrameFor` must
  // run before `blendedPose`.
  const jump = d.def ? jumpTimingFor(d.def) : undefined;
  const clipFrame = clipFrameFor(state.vfx.poseBlend, f, name, frame);
  const posed = { ...f, actionFrame: clipFrame };
  // The spin is folded into the sample *before* the fade, as the 3D layer folds
  // it (`fighterPose.ts`): the two share the fade's state (`vfx.poseBlend`).
  const sample = samplePoseForFighter(posed, frame, timing, jump);
  const pose = blendedPose(
    state.vfx.poseBlend,
    f,
    name,
    { ...sample, rotation: sample.rotation + poseSpinFor(posed, frame, timing, jump) },
    frame,
  );
  // What hangs on the fighter hangs on the model's head, not the 2D rig's
  // height: SSBU-sized Donkey Kong is 26.3 units tall, his rig 11.
  const anchor = state.anchors?.[f.port] ?? null;
  const height = anchor ? anchor.headTop : visualHeight(rig);

  const screen = worldToScreen(
    cam,
    d.x + pose.offsetX * f.facing * rig.scale + hitlagShake(f),
    d.y + pose.offsetY * rig.scale,
  );

  // A special's own graphic, which may replace the fighter — Kirby's Stone is
  // the fighter, not a prop held by one.
  const fx = drawMoveFx(ctx, d.def, f, cam, height, screen.x, screen.y, {
    lastHit: state.vfx.lastHit,
    frame: state.current.frame,
  });

  // Whatever the effect asked to be painted after the body: the near half of a
  // drill, the tip of a swing that passes in front of the shoulder, a spark on
  // the fist rather than behind it. Before the port tag, which is readability
  // the player needs and a move graphic should not bury.
  for (const paint of fx.over) paint();

  drawFinalSmashAura(ctx, f, cam, height, state.current.frame);
  // Above the fighter, and after them, because a broken shield is drawn at the
  // back of the pile and the stars are the part that has to survive that.
  drawDizzyStars(ctx, f, cam, height);

  // The tag clears the fighter's *silhouette*, not their skeleton.
  //
  // `visualHeight` measures bones and the head circle, so a fighter whose
  // identifying shape sits on top of their head wore the tag on it. Four agents
  // reported this independently, on four different characters and for four
  // different reasons: Pikachu's ears (the one shape that names him at sixty
  // pixels), Samus's drill tip, Mario's Super Jump Punch — which cannot punch
  // straight up and be seen — and Link's boomerang, where the tag clipped the
  // inboard arm of the V and left one arm, which reads as a hank of hair. The
  // symmetry that made it a boomerang was exactly what was being cut off.
  const label = state.cpu?.[f.port] ? "CPU" : `P${f.port + 1}`;
  if (anchor) {
    // A unit over the head capsule: the capsule covers three quarters of the
    // head's vertices, so ears and hat brims stand a little proud of it.
    const head = worldToScreen(cam, d.x + anchor.headX, d.y + anchor.headTop + 1);
    drawPortTag(ctx, head.x, head.y - 14, f.port, label, Math.max(0.6, cam.zoom / 7));
    return fx.hideFigure;
  }
  const clearance = (rig.tagClearance ?? 0) * rig.scale;
  const tagY = screen.y - (height + clearance) * cam.zoom - 14;
  drawPortTag(ctx, screen.x, tagY, f.port, label, Math.max(0.6, cam.zoom / 7));
  return fx.hideFigure;
}

/**
 * Painter's-algorithm depth: lower is drawn first, so higher ends up in front.
 *
 * Exported so the ordering is a stated rule with a test rather than a sort
 * comparator nobody can see the intent of.
 */
export function drawDepth(f: FighterState): number {
  switch (f.action) {
    // Being hit, held or floored: you are the thing being done to.
    case "hitstun":
    case "tumble":
    // Tumbling on after the hitstun is still the same body in the same flight:
    // it stays behind its attacker instead of jumping in front when hitstun ends.
    case "tumbleFall":
    case "grabbed":
    case "thrown":
    case "downed":
    case "shieldBroken":
      return 0;
    // Doing something to somebody.
    case "attack":
    case "special":
    case "grab":
    case "grabHold":
    case "pummel":
    case "throw":
      return 2;
    default:
      return 1;
  }
}

/** Intangible frames blink; invincible ones do not (SPEC's distinction). */
export function intangibleAlpha(f: FighterState): number {
  if (f.intangible > 0) return f.actionFrame % 6 < 3 ? 0.42 : 0.8;
  if (f.invincible > 0) return 0.92;
  if (f.action === "respawnPlatform") return 0.85;
  return 1;
}

/* ------------------------------------------------- magnifying-glass glyph -- */

function drawIndicators(ctx: CanvasRenderingContext2D, state: RenderState, cam: Camera): void {
  const indicators = offscreenIndicators(cam, state.current, state.stage);
  for (const ind of indicators) {
    const def = state.fighters[ind.port] ?? null;
    const rig = getCharacterRig(def?.id);
    const colour = PORT_COLOURS[ind.port % PORT_COLOURS.length];
    const r = 46 * ind.scale;

    ctx.save();
    // The lens.
    ctx.beginPath();
    ctx.arc(ind.x, ind.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10,12,16,0.72)";
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(3, 5 * ind.scale);
    ctx.lineCap = "square";
    ctx.stroke();

    // The fighter inside it, as a silhouette in their port colour.
    ctx.save();
    ctx.beginPath();
    ctx.arc(ind.x, ind.y, r * 0.86, 0, Math.PI * 2);
    ctx.clip();
    drawStockIcon(ctx, rig, ind.x, ind.y + r * 0.1, r * 1.25, withAlpha(colour, 0.95));
    ctx.restore();

    // The arrow, pointing further out along the same bearing.
    const ax = ind.x + Math.cos(ind.angle) * (r + 12);
    const ay = ind.y + Math.sin(ind.angle) * (r + 12);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ind.angle);
    ctx.beginPath();
    ctx.moveTo(18 * ind.scale, 0);
    ctx.lineTo(-6 * ind.scale, 11 * ind.scale);
    ctx.lineTo(-6 * ind.scale, -11 * ind.scale);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }
}

/** Where the indicator ring sits, for anything that needs to avoid it. */
export { INDICATOR_INSET };
