/**
 * The 3D layer of a match, as the play page builds it (Plan 4): one presenter
 * per match over the page's WebGL canvas, the fighters' models from a cache
 * shared across matches (a rematch does not re-download a glb), and the buffer
 * kept to the canvas's on-screen size and the display's pixel ratio.
 *
 * This module pulls in three.js, so nothing reaches it through a static import
 * from a page: `/play` loads it through `useWorld3d`'s `import()`, and the
 * online lobby through its preload's (`app/chunkSplit.test.ts`).
 */

import type { BakeTables } from "@/engine/acmd/bakeTables";
import type { FighterDef, StageDef } from "@/engine/types";
import { browserModelSource, createModelCache, type LoadedModel, type ModelCache } from "@/render3d/models/loader";
import { createRenderer3D, type Presenter3D, type Renderer3DOptions } from "@/render3d/renderer3d";
import { SKELETONS } from "@/render3d/skeletons";

let models: ModelCache | null = null;

/** The page's model cache: built on first use, kept for the page's lifetime. */
export function sharedModels(): ModelCache {
  // `console.warn` looked up when a fighter falls back, not captured once for the page's lifetime.
  models ??= createModelCache(browserModelSource(), (msg) => console.warn(msg));
  return models;
}

/**
 * Start fetching these fighters' models now — the online lobby calls it (via
 * `import()`, keeping three.js out of the lobby's own chunk) as soon as both
 * picks are known, so a match never starts on a stand-in only because its
 * download was still running.
 */
export function preloadModels(fighterIds: readonly string[]): Promise<void> {
  return sharedModels().preload(fighterIds);
}

/** One match's view of the model cache, with a wait it can call off. */
export interface WaitingModels extends ModelCache {
  /**
   * The match is over: every wait still running stops, so nothing says a
   * fighter of a match that has gone will be drawn as a stand-in. Asking
   * afterwards waits on the cache alone.
   */
  cancel(): void;
}

/**
 * `cache`, as one match sees it when it can wait only `ms` for a model (ruling
 * R3, online): a model that has not arrived by then is a stand-in for this
 * match. The download carries on in `cache`, so the next match has it; this
 * one never swaps a stand-in for a model mid-match.
 */
export function withModelWait(cache: ModelCache, ms: number, warn: (msg: string) => void = console.warn): WaitingModels {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let cancelled = false;
  return {
    get(id) {
      if (cancelled) return cache.get(id);
      return new Promise<LoadedModel>((resolve) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          const reason = `not loaded within ${ms} ms (online)`;
          warn(`David-Smash: drawing ${id} as a stand-in — ${reason}`);
          resolve({ kind: "standIn", reason });
        }, ms);
        timers.add(timer);
        // `get` never rejects (`createModelCache`): a failure is already a stand-in.
        void cache.get(id).then((model) => {
          clearTimeout(timer);
          timers.delete(timer);
          resolve(model);
        });
      });
    },
    preload: (ids) => cache.preload(ids),
    status: () => cache.status(),
    cancel() {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

export interface WorldLayers {
  /**
   * The WebGL canvas, under the overlay. A disposed presenter leaves its
   * context usable, so the next match may draw on the same canvas (React's
   * development remount does; Task 20 carry 14).
   */
  readonly gl: HTMLCanvasElement;
  /** The 2D canvas for the stage's sky, under the WebGL canvas. */
  readonly background: HTMLCanvasElement;
}

export interface WorldOptions {
  /**
   * The longest the match waits for a model before playing that fighter as a
   * stand-in. Online only (ruling R3): the peer whose models came first is
   * stalled waiting for this one, and its link monitor calls a match lost
   * after `STALL_LOST_MS`. Absent, a local match waits on the loader's own
   * timeouts: `MODEL_TIMEOUT_MS` per request, so twice that at worst.
   */
  readonly modelWaitMs?: number;
  /** The WebGL renderer; tests pass a fake (`Renderer3DOptions.makeGL`). */
  readonly makeGL?: Renderer3DOptions["makeGL"];
  /** A lost WebGL context gone for good, or back after all (`Renderer3DOptions.onContextGone`). */
  readonly onContextGone?: Renderer3DOptions["onContextGone"];
}

/** A presenter for one match. Its `ready` resolves once every fighter has a model or a stand-in. */
export function createWorld(
  layers: WorldLayers,
  stage: StageDef,
  defs: readonly FighterDef[],
  bake: BakeTables,
  options: WorldOptions = {},
): Presenter3D {
  const world = (models: ModelCache) =>
    createRenderer3D({ canvas: layers.gl, stage, defs, bake, skeletons: SKELETONS, models, makeGL: options.makeGL, onContextGone: options.onContextGone });
  if (options.modelWaitMs === undefined) return world(sharedModels());
  const waiting = withModelWait(sharedModels(), options.modelWaitMs);
  const presenter = world(waiting);
  return {
    ...presenter,
    // A player who leaves while the models load hears nothing more of this match.
    dispose() {
      waiting.cancel();
      presenter.dispose();
    },
  };
}

/** Keep the presenter's buffer to the canvas's CSS size × DPR; returns the unsubscribe. */
export function followSize(canvas: HTMLCanvasElement, presenter: Pick<Presenter3D, "resize">): () => void {
  const apply = () => {
    const r = canvas.getBoundingClientRect();
    presenter.resize(r.width, r.height, window.devicePixelRatio || 1);
  };
  apply();
  const observer = new ResizeObserver(apply);
  observer.observe(canvas);
  // A DPR change (dragging the window to another display) fires no resize.
  let dpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onDpr = () => {
    apply();
    dpr.removeEventListener("change", onDpr);
    dpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dpr.addEventListener("change", onDpr);
  };
  dpr.addEventListener("change", onDpr);
  return () => {
    observer.disconnect();
    dpr.removeEventListener("change", onDpr);
  };
}
