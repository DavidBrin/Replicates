"use client";

/**
 * The animation lab in 3D (Plan 4): the fighter's SSBU model posed by the same
 * `drawnPose` the match uses (`Fighter3D`, through the shared retarget
 * `driveFor` reads), one cell per frame at the action's true length, with this
 * frame's hitboxes (red) and hurtboxes (yellow) drawn over it from the sim's own
 * bone table — so an author tunes a clip against the limbs and boxes the game
 * actually plays (D52: "the lab and the renderer disagreed four times").
 *
 * One WebGL renderer draws every cell through a scissor rectangle, so a
 * 91-frame Fire Fox is 91 cells and one context, not 91 contexts. It lives as
 * long as the sheet is on the page: a new action or fighter redraws through it,
 * and it is disposed when the sheet unmounts.
 *
 * This module imports three.js, so `page.tsx` loads it through `import()`
 * (`app/chunkSplit.test.ts`).
 */

import { useEffect, useRef, useState } from "react";
import { Box3, Color, NoToneMapping, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Object3D, type PerspectiveCamera } from "three";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
import { playsMoveScript } from "@/engine/acmd/poseClock";
import { moveScriptFrame } from "@/engine/acmd/run";
import { toFloat } from "@/engine/fixed";
import type { Capsule } from "@/engine/hitbox";
import type { FighterState } from "@/engine/types";
import { sharedModels } from "@/game/world3d";
import { useBake } from "@/game/useBake";
import { fighterPoser } from "@/render3d/bake/bake";
import { applySideCamera, createSideCamera } from "@/render3d/camera3d";
import { createFighter3D, type Fighter3D } from "@/render3d/fighter3d";
import { createLights, drawnResources } from "@/render3d/renderer3d";
import { SKELETONS } from "@/render3d/skeletons";
import { fighterAt, gameFighterFor, type Options } from "./page";

/** One cell's side in pixels and the cells per row: the 2D contact sheet's, so the two sheets read alike. */
export const CELL = 150;
export const COLUMNS = 12;

/** The least height a cell shows, in world units: a standing Mario with room round him. UNVERIFIED (cosmetic): by eye. */
const MIN_VIEW = 22;
/** World units of air kept round the outermost thing drawn, for perspective (a part nearer the camera than the z = 0 plane draws larger). UNVERIFIED (cosmetic): by eye. */
const MARGIN = 2;

export interface LabBoxes {
  readonly hit: Capsule[];
  readonly hurt: Capsule[];
}

/**
 * The facing-relative capsules the sim plays for `f` on `frame`: every live
 * hitbox of its move and every hurtbox, in the game's units (Q12), origin at the
 * feet and +x forward.
 *
 * Both come from the game's own tables, as `step()` reads them: the fighter is
 * the game's (`gameFighterFor`: limb-bone scripts placed through `bake`), the
 * hitboxes are `scriptHitboxes` over its move script (the sim's
 * `gatherHitboxes`, which only looks while an attacking status runs, as
 * `playsMoveScript` says — the lab's fighter always carries the dropdown's move,
 * and a landing must not show a smash's boxes), the hurtboxes the bake's
 * (`localHurtboxes`).
 */
export function labBoxes(o: Options, f: FighterState, frame: number, bake: BakeTables): LabBoxes {
  const def = gameFighterFor(o.fighterId, bake);
  if (def === undefined) throw new Error(`no fighter "${o.fighterId}"`);
  const run = playsMoveScript(f.action) ? moveScriptFrame(def, f) : null;
  const hit =
    run === null
      ? []
      : scriptHitboxes(run.state, def.id, run.script.motion, run.gameFrame, bake.bones).map((h) => ({
          x1: h.x,
          y1: h.y,
          x2: h.x2 ?? h.x,
          y2: h.y2 ?? h.y,
          r: h.radius,
        }));
  return { hit, hurt: localHurtboxes(def, f, frame, bake) ?? [] };
}

/** A box round something drawn, in world units. */
export interface Extent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** The box round every capsule of a cell, radii included; null for a cell with none. */
export function boxExtent(cell: LabBoxes): Extent | null {
  let e: Extent | null = null;
  for (const k of [...cell.hit, ...cell.hurt]) {
    const r = toFloat(k.r);
    e = unite(e, { minX: Math.min(toFloat(k.x1), toFloat(k.x2)) - r, maxX: Math.max(toFloat(k.x1), toFloat(k.x2)) + r, minY: Math.min(toFloat(k.y1), toFloat(k.y2)) - r, maxY: Math.max(toFloat(k.y1), toFloat(k.y2)) + r });
  }
  return e;
}

/**
 * The box round what is drawn of `root` as posed now, skinning applied (a tail,
 * a sword or a hat is no hurtbox, and a window cut to the boxes alone clipped
 * Fox's tail and Link's blade); null if nothing is drawn. `root`'s matrices
 * must be current (`Fighter3D.update` builds them).
 */
export function modelExtent(root: Object3D): Extent | null {
  const box = new Box3().setFromObject(root, true);
  return box.isEmpty() ? null : { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y };
}

function unite(a: Extent | null, b: Extent | null): Extent | null {
  if (a === null || b === null) return a ?? b;
  return { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY) };
}

/** The window every cell of a sheet looks through, in world units: centred on (x, y), `size` high and as wide. */
export interface SheetView {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/**
 * One window for the whole sheet, big enough for everything drawn in every cell
 * (`extents`: each cell's boxes and model): the same fighter at the same scale
 * in each, so frames compare. It never goes below `MIN_VIEW`, and it grows for
 * what the plan's first sketch cut off — a fixed 22-unit window clipped Donkey
 * Kong, who stands 26 units tall, and any swing that reaches past the cell.
 */
export function sheetView(extents: readonly (Extent | null)[]): SheetView {
  let all: Extent | null = null;
  for (const e of extents) all = unite(all, e);
  // A sheet with nothing drawn (no bake coverage): a standing fighter's window.
  if (all === null) return { x: 0, y: MIN_VIEW / 2, size: MIN_VIEW };
  return { x: (all.minX + all.maxX) / 2, y: (all.minY + all.maxY) / 2, size: Math.max(MIN_VIEW, Math.max(all.maxX - all.minX, all.maxY - all.minY) + 2 * MARGIN) };
}

function drawCapsules(ctx: CanvasRenderingContext2D, cam: PerspectiveCamera, ox: number, oy: number, caps: readonly Capsule[], colour: string): void {
  if (caps.length === 0) return;
  const at = new Vector3();
  // The z = 0 plane, where the sim lives, through the same camera the model is drawn with.
  const toPx = (x: number, y: number) => {
    at.set(toFloat(x), toFloat(y), 0).project(cam);
    return { x: ox + ((at.x + 1) / 2) * CELL, y: oy + ((1 - at.y) / 2) * CELL };
  };
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  for (const c of caps) {
    const a = toPx(c.x1, c.y1);
    const b = toPx(c.x2, c.y2);
    const r = Math.abs(toPx(c.x1 + c.r, c.y1).x - a.x);
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.moveTo(b.x + r, b.y);
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

/** What the sheet owns on the GL canvas, for as long as it is mounted. */
interface Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
}

function makeStage(canvas: HTMLCanvasElement): Stage {
  // `preserveDrawingBuffer`: the sheet is drawn once and then photographed (`scripts/animsheet.mjs`), not animated.
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  // As the match draws: sRGB out, no tone mapping (`renderer3d.ts`).
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.setScissorTest(true);
  const scene = new Scene();
  scene.background = new Color(0x12151a);
  const { hemisphere, ambient, sun } = createLights();
  scene.add(hemisphere, ambient, sun);
  return { renderer, scene, camera: createSideCamera() };
}

/** A fighter built for the sheet, and whose it is: a sheet never draws one fighter's model with another's options. */
interface Built {
  readonly id: string;
  readonly fighter: Fighter3D;
}

export function Lab3D({ options, total, frame }: { options: Options; total: number; frame: number }) {
  const gl = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const { tables: bake, error: bakeError } = useBake();
  const [built, setBuilt] = useState<Built | null>(null);
  const [model, setModel] = useState<{ id: string; text: string } | null>(null);

  // The fighter: their model (or a stand-in) on the match's own pose path.
  useEffect(() => {
    if (bake === null) return;
    let live = true;
    let made: Fighter3D | null = null;
    const id = options.fighterId;
    const def = gameFighterFor(id, bake);
    if (def === undefined) return;
    void sharedModels()
      .get(def.id)
      .then((loaded) => {
        if (!live) return;
        try {
          made = createFighter3D({ def, port: 0, poser: fighterPoser(def, SKELETONS[def.id]), bake, model: loaded });
        } catch (e) {
          setModel({ id, text: e instanceof Error ? e.message : String(e) });
          return;
        }
        setBuilt({ id, fighter: made });
        setModel({ id, text: loaded.kind === "glb" ? "model" : `stand-in (${loaded.reason})` });
      });
    return () => {
      live = false;
      if (made !== null) {
        const gone = made;
        // The sheet must not draw it again: back to this fighter before the other's model is in would match the old one's id.
        setBuilt((b) => (b?.fighter === gone ? null : b));
        // The model's geometry and textures are the shared cache's, but the GPU's copies are this renderer's: free them
        // (the cache keeps the data, and uploads it again next time), as the match's presenter does when it ends.
        for (const r of drawnResources(gone.placement)) r.dispose();
        gone.dispose();
      }
    };
  }, [bake, options.fighterId]);

  // Every cell: pose the model, draw it through the cell's scissor rectangle, put the sim's boxes over it.
  useEffect(() => {
    const canvas = gl.current;
    const over = overlay.current;
    const wrapper = sheet.current;
    if (!canvas || !over || !wrapper || !bake || built === null || built.id !== options.fighterId) return;
    const ctx = over.getContext("2d");
    if (!ctx) return;
    stage.current ??= makeStage(canvas);
    const { renderer, scene, camera } = stage.current;
    const { fighter } = built;
    wrapper.removeAttribute("data-drawn");

    const cols = Math.min(total, COLUMNS);
    const rows = Math.ceil(total / COLUMNS);
    const width = cols * CELL;
    const height = rows * CELL;
    // Sizing the renderer (not the canvas) keeps three's own idea of its size in step; it never styles the canvas.
    renderer.setSize(width, height, false);
    over.width = width;
    over.height = height;

    // Each cell is the fighter that many frames into the action, at the origin facing forward.
    const cells = Array.from({ length: total }, (_, i) => {
      const f: FighterState = { ...fighterAt(options, i), x: 0, y: 0, facing: 1 };
      return { f, boxes: labBoxes(options, f, i, bake) };
    });
    const pose = (i: number) => fighter.update({ f: cells[i].f, x: 0, y: 0, frame: i, blends: null, hitFlash: 0, hidden: false });
    // A first pass poses every cell to measure the model, so one window holds all of it.
    const view = sheetView(
      cells.map((c, i) => {
        pose(i);
        return unite(boxExtent(c.boxes), modelExtent(fighter.placement));
      }),
    );
    // `size` units of height per cell, square cells.
    applySideCamera(camera, { x: view.x, y: view.y, zoom: 1080 / view.size, shakeX: 0, shakeY: 0 });
    camera.aspect = 1;
    camera.updateProjectionMatrix();

    scene.add(fighter.placement);
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < total; i++) {
      const col = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const { boxes } = cells[i];
      pose(i);
      // WebGL counts from the bottom edge.
      const bottom = height - (row + 1) * CELL;
      renderer.setViewport(col * CELL, bottom, CELL, CELL);
      renderer.setScissor(col * CELL, bottom, CELL, CELL);
      renderer.render(scene, camera);
      drawCapsules(ctx, camera, col * CELL, row * CELL, boxes.hurt, "rgba(255,214,0,0.8)");
      drawCapsules(ctx, camera, col * CELL, row * CELL, boxes.hit, "rgba(255,60,60,0.95)");
      ctx.fillStyle = "#7C8896";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(`${i}`, col * CELL + 4, row * CELL + 12);
    }
    wrapper.setAttribute("data-drawn", "true");
    return () => {
      scene.remove(fighter.placement);
      wrapper.removeAttribute("data-drawn");
    };
  }, [built, bake, options, total]);

  // The one renderer, freed when the sheet leaves the page.
  useEffect(
    () => () => {
      const s = stage.current;
      stage.current = null;
      if (s === null) return;
      s.scene.clear();
      s.renderer.dispose();
    },
    [],
  );

  const status = bakeError ?? (bake !== null && model?.id === options.fighterId ? model.text : "loading");

  return (
    <section>
      <div style={{ color: "#7C8896", fontSize: 12, margin: "6px 0" }}>
        model sheet — {status}; red: hitboxes, yellow: hurtboxes (the sim&apos;s own) — frame {frame}
      </div>
      <div ref={sheet} aria-label="Model sheet" style={{ position: "relative", display: "inline-block" }}>
        <canvas ref={gl} />
        <canvas ref={overlay} style={{ position: "absolute", inset: 0 }} />
      </div>
    </section>
  );
}
