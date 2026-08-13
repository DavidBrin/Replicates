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
  drawFigure,
  drawPortRing,
  drawPortTag,
  drawStockIcon,
  getCharacterRig,
  hitlagShake,
  resolvePalette,
  squashFor,
  withAlpha,
  type CharacterRig,
} from "./characterArt";
import { drawHud, updateHud, type HudFighterInfo, type HudState } from "./hud";
import { moveTimingFor, poseNameFor, poseSpinFor, samplePoseForFighter, type PoseSample } from "./poses";
import { blendedPose, clipFrameFor } from "./blend";
import { rigHeight, type RigTransform } from "./skeleton";
import { drawBackground, drawBlastZone, drawPlatforms } from "./stageArt";
import { drawSpecialFx } from "./specialFx";
import { drawSwingArc, swingArcFor } from "./swing";
import {
  drawFinalSmashAura,
  drawKoFlash,
  drawParticles,
  drawProjectiles,
  drawScreenKos,
  drawShield,
  drawSmashBall,
  drawStarKos,
  hitFlashAmount,
  type ProjectileVisual,
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
  /** Renders every fighter in flat black, to check silhouette readability. */
  readonly debugSilhouette?: boolean;
  readonly showBlastZone?: boolean;
}

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
 * Draw one frame.
 *
 * Order is load-bearing and is exactly: parallax background, stage platforms,
 * fighters (each one's rim before its body), Smash Ball, particles, HUD,
 * magnifying-glass indicators. Fighters before the ball so a contested Smash
 * Ball is never hidden behind somebody; particles after fighters so a hit spark
 * lands *on* the victim; the HUD above all of it; the indicators last because
 * they are the one thing that must never be occluded.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  events: StepEvents | null,
  camera: Camera,
  interpolationAlpha: number,
): void {
  const canvas = ctx.canvas;
  const box = computeLetterbox(canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);

  ctx.translate(box.offsetX, box.offsetY);
  ctx.scale(box.scale, box.scale);
  ctx.beginPath();
  ctx.rect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
  ctx.clip();

  drawScene(ctx, state, events, camera, interpolationAlpha);

  ctx.restore();
}

/** The 1920×1080 frame itself, with the letterbox transform already applied. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  events: StepEvents | null,
  camera: Camera,
  interpolationAlpha: number,
): void {
  const game = state.current;
  const stage = state.stage;
  const mode = state.debugSilhouette ? "silhouette" : "body";

  drawBackground(ctx, stage, camera, game.frame);
  drawPlatforms(ctx, stage, camera, game.frame);
  if (state.showBlastZone) drawBlastZone(ctx, stage, camera);

  const drawn = state.current.fighters.map<DrawnFighter>((fighter) => {
    const previous = state.previous?.fighters.find((f) => f.port === fighter.port);
    const pos = interpolatePosition(previous, fighter, interpolationAlpha);
    const def = state.fighters[fighter.port] ?? null;
    return { fighter, x: pos.x, y: pos.y, def, rig: getCharacterRig(def?.id) };
  });

  // Dodge afterimages sit under every fighter so a rolling player never hides
  // behind their own ghosts.
  drawAfterimages(ctx, state, camera, drawn);

  // Swings go under the fighters, so the blade passes behind the arm that
  // swung it rather than washing the fighter out.
  for (const d of drawn) {
    if (d.fighter.action === "dead") continue;
    const arc = swingArcFor(d.def, d.fighter, visualHeight(d.rig));
    if (arc) drawSwingArc(ctx, arc, camera);
  }

  // Whoever is doing something goes on top.
  //
  // Port order is the obvious draw order and it is the wrong one: it means the
  // player on port 1 spends every exchange hidden behind whoever is on port 2,
  // and against a body as wide as Donkey Kong's, "hidden" is literal — a
  // forward smash landing squarely was invisible because the fighter throwing
  // it was entirely behind the fighter taking it. Sorting by what each fighter
  // is doing keeps the attacker and the launch both readable, and it is stable,
  // so two idle fighters do not swap depth every time one of them twitches.
  for (const d of [...drawn].sort((a, b) => drawDepth(a.fighter) - drawDepth(b.fighter))) {
    if (d.fighter.action === "dead") continue;
    drawOneFighter(ctx, state, camera, d, mode);
  }

  drawProjectiles(ctx, game, camera, projectileVisual(state));
  drawSmashBall(ctx, game, camera);
  drawParticles(ctx, state.vfx, camera);
  drawStarKos(ctx, state.vfx, camera);
  drawKoFlash(ctx, state.vfx);
  drawScreenKos(ctx, state.vfx);

  updateHud(state.hud, game);
  drawHud(ctx, { state: game, info: hudInfo(state), hud: state.hud });

  drawIndicators(ctx, state, camera);
}

/**
 * Look a projectile's drawing hint up by its definition id.
 *
 * `ProjectileState` carries only `defId`; the `visual` lives on the
 * `ProjectileDef` inside whichever move launches it. Rather than have
 * `fighters/` publish a second index for the renderer's benefit, this walks the
 * loaded fighter definitions once and memoises the result on the roster array —
 * the roster does not change during a match, so the walk happens once per match
 * rather than once per frame.
 */
const VISUAL_CACHE = new WeakMap<object, Map<string, ProjectileVisual>>();

export function projectileVisual(state: RenderState): (defId: string) => ProjectileVisual {
  const key = state.fighters as unknown as object;
  let index = VISUAL_CACHE.get(key);
  if (!index) {
    index = new Map<string, ProjectileVisual>();
    for (const def of state.fighters) {
      if (!def) continue;
      for (const move of Object.values(def.moves)) {
        for (const projectile of move?.projectiles ?? []) {
          index.set(projectile.id, projectile.visual);
        }
      }
    }
    VISUAL_CACHE.set(key, index);
  }
  const resolved = index;
  return (defId: string) => resolved.get(defId) ?? "energy";
}

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

function drawOneFighter(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  cam: Camera,
  d: DrawnFighter,
  mode: "body" | "silhouette",
): void {
  const f = d.fighter;
  const rig = d.rig;
  const palette = resolvePalette(d.def, f.costume);
  const timing = moveTimingFor(d.def, f.move);
  const frame = state.current.frame;
  const name = poseNameFor(f);
  // Clips are sampled on their own clock and faded out of whatever was on
  // screen last frame, so that a change of clip is a transition and not a cut.
  // See `blend.ts` — `clipFrameFor` must run before `blendedPose`.
  const attrs = d.def?.attributes;
  const clipFrame = clipFrameFor(state.vfx.poseBlend, f, name, frame);
  const posed = { ...f, actionFrame: clipFrame };
  const pose = blendedPose(
    state.vfx.poseBlend,
    f,
    name,
    samplePoseForFighter(posed, frame, timing, attrs),
    frame,
  );
  const squash = squashFor(f);
  const height = visualHeight(rig);

  const screen = worldToScreen(
    cam,
    d.x + pose.offsetX * f.facing * rig.scale + hitlagShake(f),
    d.y + pose.offsetY * rig.scale,
  );
  const transform: RigTransform = {
    x: screen.x,
    y: screen.y,
    scale: cam.zoom * rig.scale,
    scaleX: squash.scaleX * pose.scaleX,
    scaleY: squash.scaleY * pose.scaleY,
    facing: f.facing >= 0 ? 1 : -1,
    // No facing multiplier: `resolve` mirrors x, which already reverses the
    // visual sense of a rotation. Signing the spin here as well cancelled that
    // out, so a fighter rolling left spun the same way on screen as one rolling
    // right — backwards relative to travel. `skeleton.test.ts` pins the
    // property this relies on.
    rotation: pose.rotation + poseSpinFor(posed, frame, timing, attrs),
    pivot: rigHeight(rig.bones, rig.headRadius) * 0.45,
  };

  // The port ring goes under the feet, before the rim, so the rim overlaps it.
  if (f.grounded && f.action !== "downed") {
    drawPortRing(ctx, screen.x, screen.y, height * cam.zoom * 0.36, f.port, 0.55);
  }

  const alpha = intangibleAlpha(f);
  const rimWidth = Math.max(2.5, cam.zoom * 0.55);

  const params = {
    rig,
    palette,
    pose,
    transform,
    alpha,
    tint: { colour: "#FFFFFF", amount: hitFlashAmount(state.vfx, f.port) },
  } as const;

  // A special's own graphic goes under the fighter, and may replace them —
  // Kirby's Stone is the fighter, not a prop held by one.
  const fx = drawSpecialFx(ctx, d.def, f, cam, height, screen.x, screen.y);

  if (!fx.hideFigure) {
    if (mode !== "silhouette") drawFigure(ctx, { ...params, mode: "rim", rimWidth });
    drawFigure(ctx, { ...params, mode });
  }

  drawFinalSmashAura(ctx, f, cam, height, state.current.frame);
  drawShield(ctx, state.vfx, f, cam, height);

  const label = state.cpu?.[f.port] ? "CPU" : `P${f.port + 1}`;
  drawPortTag(ctx, screen.x, screen.y - height * cam.zoom - 14, f.port, label, Math.max(0.6, cam.zoom / 7));
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
function intangibleAlpha(f: FighterState): number {
  if (f.intangible > 0) return f.actionFrame % 6 < 3 ? 0.42 : 0.8;
  if (f.invincible > 0) return 0.92;
  if (f.action === "respawnPlatform") return 0.85;
  return 1;
}


function drawAfterimages(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  cam: Camera,
  drawn: readonly DrawnFighter[],
): void {
  if (state.vfx.afterimages.length === 0) return;
  const rest: PoseSample = { angles: {}, offsetX: 0, offsetY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  ctx.save();
  for (const image of state.vfx.afterimages) {
    const owner = drawn.find((d) => d.fighter.port === image.port);
    if (!owner) continue;
    const s = worldToScreen(cam, image.x, image.y);
    drawFigure(ctx, {
      rig: owner.rig,
      palette: resolvePalette(owner.def, owner.fighter.costume),
      pose: rest,
      transform: {
        x: s.x,
        y: s.y,
        scale: cam.zoom * owner.rig.scale,
        facing: image.facing >= 0 ? 1 : -1,
      },
      mode: "silhouette",
      alpha: (image.life / image.maxLife) * 0.28,
    });
  }
  ctx.restore();
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
