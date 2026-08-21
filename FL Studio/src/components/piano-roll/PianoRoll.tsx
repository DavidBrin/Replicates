"use client";

/**
 * The Piano Roll host — SPEC §4.2: **one `<canvas>` 2D, imperative**, painted
 * from a `ref` on a `requestAnimationFrame`-on-dirty loop, with React owning
 * the surrounding chrome only.
 *
 * This component is deliberately thin, and everything hard lives beside it in
 * pure modules: `geometry.ts` (tick/pitch ↔ px), `renderer.ts` (draw
 * functions over a `DrawSurface` interface), `interactions.ts` (the gesture
 * state machine), `bindings.ts` (keyboard), `uiState.ts` (the store slice).
 * The host only: sizes the canvas for `devicePixelRatio`, subscribes to the
 * stores and marks the frame dirty, converts DOM events into the machine's
 * plain input records, and reads the theme out of `pianoRoll.css`.
 *
 * There is **no per-note React component** and no store subscription in the
 * paint path beyond one dirty flag, which is the whole point of §4.2.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import "./pianoRoll.css";

import { nextId } from "@/domain/ids";
import { SNAP_LABELS, SNAP_UNITS, type SnapUnit } from "@/domain/tickMath";
import type { Channel, Note } from "@/domain/types";
import { engineStub, useWiringState } from "@/components/shell/wiring";
import { useAppStore } from "@/lib/store";

import { KEYBOARD_WIDTH } from "./geometry";
import { createPianoRollController, type RollPointer } from "./interactions";
import { registerPianoRollBindings } from "./bindings";
import {
  DEFAULT_ROLL_THEME,
  renderPianoRoll,
  type DrawSurface,
  type RollTheme,
} from "./renderer";
import {
  getRollUi,
  rollUiStore,
  useRollUi,
  type RollTool,
} from "./uiState";

export interface PianoRollProps {
  className?: string;
  /**
   * Playhead position in ticks while the transport runs, or `null`/absent when
   * stopped. Read every frame — SPEC §4.2: the playhead is the only thing that
   * animates continuously, and it comes from a rAF read of the transport, not
   * from a per-tick store subscription (SPEC §5).
   */
  getPlayheadTick?: () => number | null;
}

/* ---------------------------------------------------------------- theme -- */

const THEME_VARS: Record<keyof RollTheme, string> = {
  laneWhite: "--fl-roll-lane-white",
  laneBlack: "--fl-roll-lane-black",
  beatBand: "--fl-roll-beat-band",
  gridStep: "--fl-roll-grid-step",
  gridBeat: "--fl-roll-grid-beat",
  gridBeatFlank: "--fl-roll-grid-beat-flank",
  gridBar: "--fl-roll-grid-bar",
  ruler: "--fl-roll-ruler",
  rulerText: "--fl-roll-ruler-text",
  keyWhiteStart: "--fl-roll-key-white-start",
  keyWhiteEnd: "--fl-roll-key-white-end",
  keyBlack: "--fl-roll-key-black",
  keySeparator: "--fl-roll-key-separator",
  keyLabel: "--fl-roll-key-label",
  keyPressed: "--fl-roll-key-pressed",
  noteBody: "--fl-roll-note-body",
  noteTop: "--fl-roll-note-top",
  noteShadow: "--fl-roll-note-shadow",
  noteGrip: "--fl-roll-note-grip",
  noteLabel: "--fl-roll-note-label",
  noteSelected: "--fl-roll-note-selected",
  ghostNote: "--fl-roll-ghost-note",
  velocityLane: "--fl-roll-velocity-lane",
  velocityStem: "--fl-roll-velocity-stem",
  velocityStemDim: "--fl-roll-velocity-stem-dim",
  velocityBaseline: "--fl-roll-velocity-baseline",
  playhead: "--fl-roll-playhead",
  chrome: "--fl-chrome",
};

/** Resolve the surface's CSS custom properties into a painter theme (§4.3). */
export function readRollTheme(element: Element | null): RollTheme {
  if (element === null || typeof window === "undefined") return DEFAULT_ROLL_THEME;
  const computed = window.getComputedStyle(element);
  const theme = { ...DEFAULT_ROLL_THEME };
  for (const [key, cssVar] of Object.entries(THEME_VARS) as [keyof RollTheme, string][]) {
    const value = computed.getPropertyValue(cssVar).trim();
    if (value !== "") theme[key] = value;
  }
  return theme;
}

/* ----------------------------------------------------------- component -- */

export function PianoRoll({ className, getPlayheadTick }: PianoRollProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRef = useRef<RollTheme>(DEFAULT_ROLL_THEME);
  const frameRef = useRef<number | null>(null);
  // The imperative paint loop reads the playhead source through a ref so a new
  // prop identity never has to re-create the loop. Written in an effect, not
  // during render.
  const playheadRef = useRef(getPlayheadTick);
  useEffect(() => {
    playheadRef.current = getPlayheadTick;
  }, [getPlayheadTick]);

  const { isPlaying } = useWiringState();

  // Chrome-only reads. The paint path never re-renders React.
  const channels = useAppStore((state) => state.project.channelOrder);
  const channelMap = useAppStore((state) => state.project.channels);
  const snap = useRollUi((ui) => ui.pianoRoll.snap);
  const tool = useRollUi((ui) => ui.pianoRoll.tool);
  const selectedChannelId = useRollUi((ui) => ui.pianoRoll.channelId);

  const targetChannelId = selectedChannelId ?? channels[0] ?? "";
  const targetChannel: Channel | undefined = channelMap[targetChannelId];

  /* ------------------------------------------------------------- scene -- */

  /** The single place domain + UI state are combined for paint and for hits. */
  const buildScene = useCallback(() => {
    const { project } = useAppStore.getState();
    const ui = getRollUi().pianoRoll;
    const pattern = project.patterns[project.activePatternId];
    const channelId = ui.channelId ?? project.channelOrder[0] ?? "";
    const all: Note[] = pattern === undefined ? [] : Object.values(pattern.notes);
    const notes = all
      .filter((note) => note.channelId === channelId)
      .sort((a, b) => a.positionTicks - b.positionTicks);
    const ghostNotes = all.filter((note) => note.channelId !== channelId);
    return {
      ui,
      channelId,
      patternId: project.activePatternId,
      notes,
      ghostNotes,
    };
  }, []);

  /* ------------------------------------------------------------- paint -- */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return; // jsdom, or a lost context

    const { ui, notes, ghostNotes } = buildScene();
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(ui.view.width * dpr));
    const height = Math.max(1, Math.round(ui.view.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    // Reset every frame: setTransform, never scale() — scale() compounds.
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderPianoRoll(context as unknown as DrawSurface, ui.view, {
      notes,
      ghostNotes,
      selectedNoteIds: ui.selectedNoteIds,
      playheadTick: playheadRef.current?.() ?? null,
      previewPitch: ui.previewPitch,
      theme: themeRef.current,
    });
  }, [buildScene]);

  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    if (typeof window === "undefined") {
      draw();
      return;
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }, [draw]);

  // Repaint on any domain or UI change; both stores are subscribed
  // imperatively so a note edit never re-renders a React tree.
  useEffect(() => {
    themeRef.current = readRollTheme(rootRef.current);
    requestDraw();
    const unsubscribeApp = useAppStore.subscribe(requestDraw);
    const unsubscribeUi = rollUiStore.subscribe(requestDraw);
    return () => {
      unsubscribeApp();
      unsubscribeUi();
      if (frameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [requestDraw]);

  // The playhead is the one continuously animated thing (SPEC §4.2).
  useEffect(() => {
    if (!isPlaying || typeof window === "undefined") return;
    let handle = 0;
    const tick = (): void => {
      draw();
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [isPlaying, draw]);

  /* -------------------------------------------------------------- size -- */

  useEffect(() => {
    const surface = canvasRef.current?.parentElement;
    if (surface === null || surface === undefined) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      getRollUi().setPianoRollView({ width, height });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  /* -------------------------------------------- gestures + key bindings -- */

  const controller = useMemo(
    () =>
      createPianoRollController({
        getScene: () => {
          const scene = buildScene();
          return {
            view: scene.ui.view,
            notes: scene.notes,
            patternId: scene.patternId,
            channelId: scene.channelId,
            snap: scene.ui.snap,
            tool: scene.ui.tool,
            selectedNoteIds: scene.ui.selectedNoteIds,
            lastLengthTicks: scene.ui.lastLengthTicks,
          };
        },
        dispatch: (command, options) => useAppStore.getState().dispatch(command, options),
        setSelection: (ids) => getRollUi().setPianoRollSelection(ids),
        setView: (patch) => getRollUi().setPianoRollView(patch),
        setLastLength: (ticks) => getRollUi().setPianoRollLastLength(ticks),
        setDragKind: (kind) => getRollUi().setPianoRollDragKind(kind),
        setPreviewPitch: (pitch) => getRollUi().setPianoRollPreviewPitch(pitch),
        // TODO(wire): the ONE audition call site — swap `engineStub` for
        // `import * as engine from "@/audio/engine"` when slice B lands.
        previewNote: (channelId, pitch) => engineStub.previewNote(channelId, pitch),
        createNoteId: () => nextId("note"),
      }),
    [buildScene],
  );

  useEffect(() => {
    return registerPianoRollBindings({
      getScene: () => {
        const scene = buildScene();
        return {
          patternId: scene.patternId,
          notes: scene.notes,
          selectedNoteIds: scene.ui.selectedNoteIds,
        };
      },
      dispatch: (command, options) => useAppStore.getState().dispatch(command, options),
      setSelection: (ids) => getRollUi().setPianoRollSelection(ids),
      toggleSnap: () => getRollUi().togglePianoRollSnap(),
    });
  }, [buildScene]);

  const toPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>): RollPointer => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      button: event.button,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
  }, []);

  // React's onWheel is passive, so `preventDefault` there is a no-op and
  // Ctrl+wheel would zoom the page instead of the roll (§4.4 primitive #2).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (event: WheelEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const handled = controller.wheel({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        button: 0,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      if (handled) event.preventDefault();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [controller]);

  /* ------------------------------------------------------------ chrome -- */

  return (
    <div ref={rootRef} className={`fl-piano-roll${className ? ` ${className}` : ""}`}>
      <div className="fl-piano-roll__bar">
        <span className="fl-piano-roll__title">Piano roll</span>
        <span className="fl-piano-roll__channel">{targetChannel?.name ?? "—"}</span>
        <select
          className="fl-piano-roll__channel-select"
          aria-label="Target channel"
          value={targetChannelId}
          onChange={(event) => getRollUi().setPianoRollChannel(event.target.value)}
        >
          {channels.map((id) => (
            <option key={id} value={id}>
              {channelMap[id]?.name ?? id}
            </option>
          ))}
        </select>

        <div className="fl-piano-roll__tools">
          {(["draw", "select", "delete"] as RollTool[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="fl-piano-roll__tool"
              aria-pressed={tool === candidate}
              onClick={() => getRollUi().setPianoRollTool(candidate)}
            >
              {candidate === "draw" ? "Draw" : candidate === "select" ? "Select" : "Del"}
            </button>
          ))}
        </div>

        <div className="fl-piano-roll__spacer" />

        <label className="fl-piano-roll__title" htmlFor="fl-roll-snap">
          Snap
        </label>
        <select
          id="fl-roll-snap"
          className="fl-piano-roll__snap"
          value={snap}
          onChange={(event) => getRollUi().setPianoRollSnap(event.target.value as SnapUnit)}
        >
          {SNAP_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {SNAP_LABELS[unit]}
            </option>
          ))}
        </select>
      </div>

      <div className="fl-piano-roll__surface">
        <canvas
          ref={canvasRef}
          className="fl-piano-roll__canvas"
          data-testid="piano-roll-canvas"
          data-keyboard-width={KEYBOARD_WIDTH}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            controller.pointerDown(toPointer(event));
          }}
          onPointerMove={(event) => controller.pointerMove(toPointer(event))}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            controller.pointerUp(toPointer(event));
          }}
          onPointerCancel={() => controller.cancel()}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>
    </div>
  );
}

export default PianoRoll;
