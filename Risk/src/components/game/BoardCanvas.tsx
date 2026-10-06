"use client";

/**
 * The board (SPEC §8's coordinate contract, §10's render loop).
 *
 * Two elements and two transforms, and nothing else:
 *
 *   `#stage`  `perspective(1400px) rotateX(θ)`
 *   `#board`  `translate(pan) scale(zoom)` — sized to the map's own viewBox,
 *             **origin honoured**, with the SVG and the HTML token layer both
 *             inside it so pan and zoom move them for free.
 *
 * The live `GameState` never passes through React: the board is built once
 * per map and painted by diff on the session's dirty flag plus a slow ambient
 * bucket.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

import { TROOPS_UNKNOWN, type MapDef } from "@/engine/types";
import { createInput, territoryAtPoint } from "@/game/input";
import type { Session } from "@/game/session";
import { useElementSize, useRenderLoop, useUi } from "@/game/useSession";
import { createArrowLayer, type ArrowLayerHandle } from "@/render/arrows";
import { createBoard, type BoardHandle, type BoardPaint } from "@/render/board";
import {
  type Camera, boardTransform, counterTransformVars, createCamera, stageTransform, withViewport,
} from "@/render/camera";
import { ownerKey, patternFor, tokenRadius } from "@/render/palette";
import { createTokenLayer, type TokenLayerHandle, type TokenPaint } from "@/render/tokens";

export interface BoardCanvasProps {
  readonly session: Session;
  /** Concealed behind the hand-off overlay (§5.4) — the board is not painted at all. */
  readonly hidden: boolean;
}

export function BoardCanvas({ session, hidden }: BoardCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<BoardHandle | null>(null);
  const tokensRef = useRef<TokenLayerHandle | null>(null);
  const arrowsRef = useRef<ArrowLayerHandle | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  /** The territory under the pointer: a label the greedy pass hid comes back. */
  const hoveredRef = useRef<number | null>(null);

  const map: MapDef = session.map;
  const [, , boardW, boardH] = map.viewBox;
  const size = useElementSize(stageRef);
  /**
   * The live viewport, for the handlers that must not be re-created when it
   * changes.
   *
   * The input effect below used to depend on `size` directly, and that made
   * every `ResizeObserver` tick detach the pointer listeners, throw the
   * `createInput` handle away — `pointers` map and all — and attach a fresh
   * one. A resize that landed **between a `pointerdown` and its
   * `pointerup`** therefore lost the tap in silence: the new handle had never
   * seen the press, so `onPointerUp` found no matching entry and returned
   * before the hit test (`src/game/input.ts`). Both events still arrived at
   * `#stage`, the hit test still resolved to the right territory and every
   * `canAct()` precondition still held, which is exactly what makes the
   * symptom so hard to read.
   *
   * Resizes are not rare: a phone rotating, a mobile URL bar collapsing
   * `100dvh`, a desktop window dragged, and — on the online route — the
   * document scrollbar the lobby had and the board does not.
   */
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  const radius = useMemo(() => tokenRadius(map.territories.length), [map.territories.length]);
  const colourPatterns = useUi(session, (s) => s.settings.colourPatterns);

  /* ---- build once per map ------------------------------------------- */
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const board = createBoard(map);
    const tokens = createTokenLayer(map);
    const arrows = createArrowLayer();
    // Above the territories, below the vignette — the vignette is the SVG's
    // last child and must stay on top (§8 step 8).
    board.svg.insertBefore(arrows.element, board.svg.lastElementChild);
    wrapper.appendChild(board.svg);
    wrapper.appendChild(tokens.element);
    boardRef.current = board;
    tokensRef.current = tokens;
    arrowsRef.current = arrows;
    session.markDirty();
    return () => {
      arrows.destroy();
      tokens.destroy();
      board.destroy();
      wrapper.replaceChildren();
      boardRef.current = null;
      tokensRef.current = null;
      arrowsRef.current = null;
    };
  }, [map, session]);

  /* ---- the camera ---------------------------------------------------- */
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    cameraRef.current = cameraRef.current
      ? withViewport(cameraRef.current, size)
      : createCamera({ board: { w: boardW, h: boardH }, viewport: size });
    session.markDirty();
  }, [size, boardW, boardH, session]);

  /* ---- input --------------------------------------------------------- */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const input = createInput({
      camera: () => cameraRef.current
        ?? createCamera({
          board: { w: boardW, h: boardH },
          viewport: sizeRef.current.w ? sizeRef.current : { w: boardW, h: boardH },
        }),
      setCamera: (next) => {
        cameraRef.current = next;
        session.markDirty();
      },
      onTap: (territory) => session.tapTerritory(territory),
      onTapAway: () => session.setMode("idle"),
    });
    const detach = input.attach(stage);
    // Hover is a *reveal* only — it changes no game state, so it marks the
    // board dirty and nothing else, and only when the territory changes.
    const onHover = (event: PointerEvent) => {
      const next = event.pointerType === "mouse"
        ? territoryAtPoint(event.clientX, event.clientY)
        : null;
      if (next === hoveredRef.current) return;
      hoveredRef.current = next;
      session.markDirty();
    };
    const onLeave = () => {
      if (hoveredRef.current === null) return;
      hoveredRef.current = null;
      session.markDirty();
    };
    stage.addEventListener("pointermove", onHover);
    stage.addEventListener("pointerleave", onLeave);
    const onKey = (event: KeyboardEvent) => {
      if (input.handleKey(event.key)) event.preventDefault();
      if (event.key === "0") {
        const cam = cameraRef.current;
        if (cam) {
          cameraRef.current = createCamera({
            board: { w: boardW, h: boardH },
            viewport: cam.viewport ?? sizeRef.current,
          });
          session.markDirty();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      detach();
      input.destroy();
      stage.removeEventListener("pointermove", onHover);
      stage.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
    };
  }, [session, boardW, boardH]);

  /* ---- paint --------------------------------------------------------- */
  const paint = useCallback(() => {
    const board = boardRef.current;
    const tokens = tokensRef.current;
    const wrapper = wrapperRef.current;
    const cam = cameraRef.current;
    if (!board || !tokens || !wrapper || !cam) return;

    const ui = session.store.getState();
    const view = session.view;
    const seats = view.seats.map((s) => ({ seat: s.seat, colour: s.colour }));
    const lit = new Set(ui.litZone);

    const owners: string[] = [];
    const states: string[] = [];
    const troops: number[] = [];
    const blizzards: number[] = [];
    const patterns: (string | null)[] = [];

    view.territories.forEach((t, i) => {
      const key = ownerKey(t.owner, seats);
      owners.push(key);
      troops.push(t.troops);
      if (t.blizzard) blizzards.push(i);
      const colour = seats.find((s) => s.seat === t.owner)?.colour ?? null;
      patterns.push(colour ? patternFor(colour, colourPatterns) : null);
      if (ui.selected === i) states.push("selected");
      else if (lit.has(i)) states.push("target");
      else if (ui.selected !== null && lit.size > 0) states.push("dimmed");
      else states.push("idle");
    });

    // A continent is ringed when one seat holds every non-blizzard tile in it
    // (R14), and every continent is ringed in overlay mode (§8 step 6).
    const rings = session.map.continents
      .filter((c) => {
        if (ui.overlayMode === "continents") return true;
        const owners = new Set(
          c.territories
            .map((t) => view.territories[t])
            .filter((tile) => tile !== undefined && !tile.blizzard)
            .map((tile) => (tile as { owner: number }).owner),
        );
        if (owners.size !== 1) return false;
        const only = [...owners][0];
        return only !== undefined && only >= 0;
      })
      .map((c) => ({ continent: c.index, colour: c.color }));

    const boardPaint: BoardPaint = { owners, states, rings, blizzards, patterns };
    board.paint(boardPaint);

    const tokenPaint: TokenPaint = {
      owners,
      troops: troops.map((n) => (n === TROOPS_UNKNOWN ? TROOPS_UNKNOWN : n)),
      selected: ui.selected,
      radius,
      showLabels: true,
      hovered: hoveredRef.current,
    };
    tokens.paint(tokenPaint, cam);

    // The camera is two transforms, written once per frame — never per token.
    const stage = stageRef.current;
    if (stage) stage.style.transform = stageTransform(cam);
    wrapper.style.transform = boardTransform(cam);
    for (const [key, value] of Object.entries(counterTransformVars(cam))) {
      wrapper.style.setProperty(key, value);
    }

    // The attack arrow follows the pending attack, the chevrons the fortify pair.
    const arrows = arrowsRef.current;
    if (arrows) {
      const attack = ui.pendingAttack;
      if (attack) {
        const from = session.map.territories[attack.from]?.token;
        const to = session.map.territories[attack.to]?.token;
        if (from && to) arrows.showAttack(from, to);
      } else if (ui.actionMode === "fortifyTo" && ui.selected !== null && ui.countRequest?.kind === "fortify") {
        const a = session.map.territories[ui.countRequest.from]?.token;
        const b = session.map.territories[ui.countRequest.to]?.token;
        if (a && b) arrows.showFortify([a, b]);
      } else {
        arrows.clear();
      }
    }
  }, [session, radius, colourPatterns]);

  useRenderLoop(hidden ? null : session, paint);

  // Repaint immediately when the hand-off overlay lifts.
  useEffect(() => {
    if (!hidden) {
      session.markDirty();
      paint();
    }
  }, [hidden, session, paint]);

  return (
    <div
      ref={stageRef}
      id="stage"
      data-testid="board-stage"
      data-hidden={hidden ? "true" : "false"}
      className="absolute inset-0 overflow-hidden touch-none"
      style={{
        transformOrigin: "50% 55%",
        background: "var(--ocean-deep)",
        visibility: hidden ? "hidden" : "visible",
        zIndex: "var(--z-ocean)",
      }}
    >
      <div
        ref={wrapperRef}
        id="board"
        data-testid="board-wrapper"
        className="origin-top-left"
        style={{ position: "relative", width: boardW, height: boardH }}
      />
    </div>
  );
}

export default BoardCanvas;
