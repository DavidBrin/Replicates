"use client";

import { useEffect, useRef } from "react";

import { attachInput, type Gesture, type KeyCommand } from "@/game/input";
import { prefersReducedMotion } from "@/game/session";
import { centreOnMap, panBy, screenToTile, setViewport, zoomAt } from "@/render/camera";
import { render, type RenderUi } from "@/render/renderer";

import { useSession } from "./SessionContext";

/**
 * The board: one canvas, one input binding, one paint loop. The loop only
 * paints when the session says something changed, an animation is in
 * flight, or the 500 ms water/bob tick advanced (SPEC §10 dirty flag).
 */
export function GameCanvas({ bottomInset }: { bottomInset: number }) {
  const session = useSession();
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = prefersReducedMotion();
    if (reduced) session.skipAnimations();
    const fontFamily = getComputedStyle(document.body).fontFamily || "monospace";

    let sized = false;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const next = setViewport(session.camera, w, h);
      session.setCamera(sized ? next : centreOnMap(next));
      sized = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onGesture = (g: Gesture) => {
      switch (g.type) {
        case "tap": {
          if (session.store.getState().tutorialStep) session.dismissTutorial();
          const tile = screenToTile(session.camera, g.x, g.y);
          if (tile) session.tapTile(tile);
          else session.deselect();
          break;
        }
        case "pan":
          session.setCamera(panBy(session.camera, g.dx, g.dy));
          break;
        case "pinch":
          session.setCamera(zoomAt(session.camera, g.factor, g.cx, g.cy));
          break;
      }
    };
    const onKey = (cmd: KeyCommand) => {
      const ui = session.store.getState();
      switch (cmd.type) {
        case "escape":
          if (ui.modal) session.setModal(null);
          else if (ui.tutorialStep) session.dismissTutorial();
          else session.deselect();
          break;
        case "undo":
          if (!ui.modal) session.undo();
          break;
        case "nextDay":
          if (!ui.modal && !ui.tutorialStep) session.endTurn();
          break;
        case "pan":
          session.setCamera(panBy(session.camera, cmd.dx, cmd.dy));
          break;
        case "zoom":
          session.setCamera(zoomAt(session.camera, cmd.factor, session.camera.viewW / 2, session.camera.viewH / 2));
          break;
      }
    };
    const detach = attachInput(canvas, { onGesture, onKey });

    let raf = 0;
    let lastBucket = -1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const active = session.tick(now);
      const bucket = reduced ? 0 : Math.floor(now / 500);
      const dirty = session.takeDirty();
      if (!dirty && !active && bucket === lastBucket) return;
      lastBucket = bucket;
      const s = session.store.getState();
      const ui: RenderUi = {
        selected: s.selected,
        litZone: s.litZone,
        shopItem: s.shopItem,
        shields: s.shields,
        selectedAt: s.selectedAt,
        anims: session.anims,
        hidden: s.hidden,
        fontFamily,
        actingPlayer: s.actingPlayer,
        reducedMotion: reduced,
      };
      render(ctx, session.state, ui, session.camera, now);
    };
    raf = requestAnimationFrame(loop);
    // repaint whenever the UI store changes, too (selection, modal, banner)
    const unsub = session.store.subscribe(() => session.markDirty());

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      detach();
      unsub();
    };
  }, [session]);

  return (
    <canvas
      ref={ref}
      data-testid="board"
      aria-label="Board"
      className="absolute left-0 top-0 w-full touch-none select-none"
      style={{ height: `calc(100% - ${bottomInset}px - env(safe-area-inset-bottom, 0px))` }}
    />
  );
}
