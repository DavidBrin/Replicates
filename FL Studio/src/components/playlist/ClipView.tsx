import { useRef, useState } from "react";

import { TICKS_PER_BAR, type Pattern, type PatternClip } from "@/domain/types";
import { useGestureSession } from "@/lib/gestureHold";
import { ClipMiniature } from "./ClipMiniature";
import { LANE_HEIGHT_PX, ticksToPx } from "./geometry";

export interface ClipViewProps {
  clip: PatternClip;
  pattern: Pattern;
  pxPerBar: number;
  selected: boolean;
  /** Left-click: select + make the clip's pattern active (SPEC.md §1.1). */
  onSelect: (clipId: string) => void;
  /** Double-click: open the pattern in the Piano Roll (SPEC.md §1.1). */
  onOpen: (clip: PatternClip) => void;
  /**
   * Right-click on the clip BODY: delete (SPEC.md §4.4's universal
   * "right-click = delete").
   *
   * The second argument is present only when the delete came from an erase
   * SWEEP crossing this clip — `pointerenter` with the secondary button held.
   * The host uses it to open one owned session for a sweep whose pointer-down
   * happened somewhere else entirely (`Playlist`'s `beginSweepIfEntering`); it
   * cannot recognise that sweep any other way, because the only event it sees
   * from it is the one delivered here. A single right-click, a menu item or a
   * test firing `contextmenu` passes nothing and stays a one-shot.
   */
  onDelete: (clipId: string, sweepEvent?: React.PointerEvent<HTMLDivElement>) => void;
  /** "Make unique" (SPEC.md D4 / lane 2 §8), from the header context menu. */
  onMakeUnique: (clipId: string) => void;
  /**
   * Drag-to-move, committed once on pointer-up (SPEC.md §2.1 drag
   * coalescing). `deltaTrackIndex` is how many lanes the pointer moved
   * across (rounded, signed) so the caller can retarget the clip's track;
   * `coalesceKey` is minted fresh per gesture (finding #7) so two separate
   * drags of the same clip never merge into one undo entry.
   */
  onDragCommit: (
    clipId: string,
    deltaTicks: number,
    deltaTrackIndex: number,
    coalesceKey: string,
    /** Alt was held at release — SPEC.md §4.4 "Alt held | bypass snap for this gesture". */
    bypassSnap: boolean,
  ) => void;
  /**
   * Shift+pointer-down (SPEC.md §4.4 "Shift+Left-click on item | clone
   * selection"): clones this clip in place and returns the new clip's id,
   * already dispatched under `coalesceKey` so a follow-on drag of the clone
   * coalesces with its creation into one undo step. Omit to disable cloning
   * (e.g. in a host that doesn't wire it).
   */
  onCloneStart?: (clipId: string, coalesceKey: string) => string;
  /**
   * Does this pointer belong to the right-drag erase sweep that is running?
   *
   * The sweep's session lives on the playlist root (it may START on empty
   * lane space), so a clip cannot ask it directly — the host passes the
   * question down. `false` means a sweep is open and this is somebody ELSE's
   * pointer: a second pointer with its own secondary button held, entering
   * the clip while the sweep's owner is mid-drag elsewhere. Deleting for it
   * would fold a clip the sweep never crossed into the sweep's coalescing
   * undo entry, under a gesture key that is not this pointer's.
   *
   * Omitted — a host with no sweep of its own, a component test firing
   * `pointerenter` directly — every entering pointer with the button down
   * erases, which is the pre-sweep behaviour and the only safe reading when
   * there is no owner to compare against.
   */
  ownsEraseSweep?: (event: React.PointerEvent<HTMLDivElement>) => boolean;
}

const DRAG_THRESHOLD_PX = 3;

/**
 * Every handler the clip itself listens for, neutralised — spread onto the
 * context menu and its backdrop.
 *
 * Both live *inside* the `.fl-clip` element (they are positioned relative to
 * it), so every event they receive bubbles into the clip's own handlers unless
 * it is stopped. `preventDefault` is not enough and was the whole bug:
 * right-clicking the backdrop to dismiss the menu ran the clip's
 * `onContextMenu`, which sees a target outside `.fl-clip__header` and
 * therefore **deleted the clip** — from a gesture whose entire intent was
 * "never mind". The click-dismiss paths leaked the same way through the
 * pointer handlers: a pointer-down on the backdrop or on a menu item opened a
 * clip drag (selecting the clip on release), and with Shift held it went
 * through `onCloneStart` and cloned the clip before the menu item ever ran.
 *
 * Stopping propagation at the overlay is the fix that covers all of them at
 * once, rather than teaching the clip's handlers to recognise their own menu.
 */
const menuOverlayProps = {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => event.stopPropagation(),
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => event.stopPropagation(),
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => event.stopPropagation(),
  onClick: (event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation(),
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation(),
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  },
} as const;

interface DragState {
  startClientX: number;
  startClientY: number;
  dragging: boolean;
  /** The clip actually being dragged — the source clip, or a shift-clone. */
  activeClipId: string;
  coalesceKey: string;
}

/**
 * One placed pattern clip (SPEC.md §4.3, lane 1 §4.2): a header strip
 * (pattern colour + name) over a live miniature of the pattern's notes.
 * Clips are always exactly one bar wide — `PATTERN_LENGTH_TICKS` is a fixed
 * constant (SPEC.md §2) — so there is no edge-resize handle here, only move.
 *
 * Right-click gesture split (SPEC.md's universal "right-click = delete"
 * collides with D4's "'Make unique' on a clip's context menu" — both are
 * normative for the same surface). Resolved here by splitting the clip's own
 * two regions: right-click the **header strip** opens a small context menu
 * (Make unique / Delete); right-click the **body** stays the universal
 * one-shot delete. This keeps the FL-signature "right-click = delete"
 * binding intact everywhere it doesn't need a menu, uses a region that
 * already exists in the DOM (`.fl-clip__header` vs `.fl-clip__body`) rather
 * than inventing a modifier key, and reserves the header — visually the
 * clip's "title bar" — for the one action (fork the pattern) users need a
 * menu, not a blind click, to reach safely.
 */
export function ClipView({
  clip,
  pattern,
  pxPerBar,
  selected,
  onSelect,
  onOpen,
  onDelete,
  onMakeUnique,
  onDragCommit,
  onCloneStart,
  ownsEraseSweep,
}: ClipViewProps) {
  const dragState = useRef<DragState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  /**
   * The drag's session (`@/lib/gestureHold`): the persistence hold — SPEC §2.2,
   * a shift-clone dispatches at pointer-DOWN, so a slow drag can otherwise let
   * the autosave debounce expire with the button still held — the per-gesture
   * `coalesceKey`, and the terminators.
   *
   * `pointercancel` is the one that was missing. A cancelled pointer never
   * delivers `pointerup`, so the hold stayed open and autosave was silent for
   * the rest of the session; and because the key stayed live, the next
   * unrelated drag of the same clip folded into the abandoned drag's undo
   * entry. The clip runs its own commit on `pointerup`, so it overrides that
   * one terminator AFTER the spread and keeps the other two.
   */
  const gesture = useGestureSession("playlist-clip-move", {
    // The `dragState` ref goes with the session, whatever ends it. The
    // terminators above cover the ends this clip hears about; `onCancel`
    // covers the ones it does not — an undo/redo/import replacing the project
    // mid-drag, unmount, another gesture pre-empting this one. Left set, the
    // next pointermove committed a move computed from a clip id and a
    // coalesce key that belong to a project that no longer exists.
    onCancel: () => {
      dragState.current = null;
    },
  });

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // jsdom (component tests) has no Pointer Events capture implementation.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const coalesceKey = gesture.begin(event);
    const activeClipId =
      event.shiftKey && onCloneStart ? onCloneStart(clip.id, coalesceKey) : clip.id;
    dragState.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      dragging: false,
      activeClipId,
      coalesceKey,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (drag === null) return;
    // Only the pointer that opened the drag moves it (`@/lib/gestureHold`
    // rule (g)); a second pointer's travel from this drag's anchor is not
    // this clip's displacement.
    if (!gesture.ownsEvent(event)) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      drag.dragging = true;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    // A foreign pointer's release must not commit — or abandon — a drag it
    // does not own: the owning button is still down, and the move it would
    // commit is measured to wherever that other pointer happens to be.
    if (drag !== null && !gesture.ownsEvent(event)) return;
    dragState.current = null;
    if (drag === null) {
      gesture.end();
      return;
    }
    const deltaPx = event.clientX - drag.startClientX;
    const deltaYPx = event.clientY - drag.startClientY;
    const deltaTrackIndex = Math.round(deltaYPx / LANE_HEIGHT_PX);
    /*
     * `finally`, because the commit can THROW.
     *
     * A command validates its own arguments and rejects the invalid ones with
     * a `CommandError` (`domain/commands/playlist.ts`), and that throw unwinds
     * straight through this handler — past `gesture.end()`, which is the one
     * call that drops the persistence hold and seals the undo entry. The
     * gesture was then open forever: autosave deferred for the rest of the
     * session, and the next unrelated edit folded into the dead drag's entry.
     * The known thrower is a start tick past the arrangement's last bar and it
     * is clamped upstream now (`Playlist`'s `handleDragCommit`), but "the
     * gesture ends even if the commit fails" is the property, not "this
     * particular commit no longer fails".
     */
    try {
      if (drag.dragging && (deltaPx !== 0 || deltaTrackIndex !== 0)) {
        const deltaTicks = (deltaPx / pxPerBar) * TICKS_PER_BAR; // snapped to a bar by the caller
        onDragCommit(
          drag.activeClipId,
          deltaTicks,
          deltaTrackIndex,
          drag.coalesceKey,
          event.altKey,
        );
      } else {
        onSelect(drag.activeClipId);
      }
    } finally {
      // AFTER the commit, never before: `end` also seals the top undo entry,
      // and sealing first would stop a shift-clone's `addClip` (dispatched at
      // pointer-down under the same key) from folding into the move it started.
      gesture.end();
    }
  }

  /**
   * A cancelled pointer (capture lost, a system gesture, the tab hidden)
   * delivers no `pointerup`. The half-finished move is abandoned — committing
   * a drag the user did not finish is worse than dropping it — but the hold
   * and the coalescing entry must close either way.
   */
  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current !== null && !gesture.ownsEvent(event)) return;
    dragState.current = null;
    gesture.end();
  }

  /**
   * Right-drag deletes *multiple* clips (SPEC.md §4.4 "Right-click-drag |
   * delete multiple"), the same sweep the channel rack's step cells and the
   * piano roll's erase gesture already implement. Only the clip the button
   * went down on used to die — the pointer could travel the whole arrangement
   * with the right button held and nothing else happened, because deletion
   * hung off `contextmenu`, which fires exactly once per press.
   *
   * A clip entered while the secondary button is down is a clip the sweep has
   * reached. `buttons` (the live button mask, unlike `button`) is what says
   * the button is still held, so a sweep that starts on empty lane space and
   * crosses into clips erases them too.
   *
   * `buttons` alone is not enough, though, and that was the hole: it is a
   * property of whichever pointer sent the event, not of the sweep. A second
   * pointer holding its own secondary button — a touch beside the mouse, a
   * stylus barrel button — entering this clip while the real sweep is being
   * dragged elsewhere deleted it, and `Playlist`'s `eraseOptions` handed that
   * delete the OPEN sweep's gesture id: a clip the owner never crossed folded
   * into the owner's single undo entry, so one Ctrl+Z put back a clip the user
   * had not asked to lose alongside the ones they had. Ownership is asked of
   * the sweep itself (`@/lib/gestureHold` rule (g)) through the host.
   */
  function handlePointerEnter(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.buttons & 2) === 0) return;
    if (ownsEraseSweep !== undefined && !ownsEraseSweep(event)) return;
    // The event goes with it: this is the sweep's only appearance on the
    // host's side when the press that started it landed off-surface, and the
    // host needs the pointer id to scope the session it opens for it.
    onDelete(clip.id, event);
  }

  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const target = event.target as HTMLElement;
    if (target.closest(".fl-clip__header")) {
      setContextMenu({ x: event.clientX, y: event.clientY });
    } else {
      onDelete(clip.id);
    }
  }

  return (
    <div
      className="fl-clip"
      data-testid={`clip-${clip.id}`}
      data-selected={selected}
      // The pattern colour is the clip's ground; `.fl-clip__body` washes it
      // down so the miniature stays readable (FL tints, it does not black out).
      style={{
        left: ticksToPx(clip.startTick, pxPerBar),
        width: pxPerBar,
        borderColor: pattern.color,
        backgroundColor: pattern.color,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      {...gesture.terminators}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerEnter={handlePointerEnter}
      onDoubleClick={() => onOpen(clip)}
      onContextMenu={handleContextMenu}
    >
      <div className="fl-clip__header" style={{ backgroundColor: pattern.color }}>
        {pattern.name}
      </div>
      <div className="fl-clip__body">
        <ClipMiniature pattern={pattern} />
      </div>
      {contextMenu && (
        <>
          <div
            className="fl-clip__context-menu-backdrop"
            {...menuOverlayProps}
            onClick={(event) => {
              event.stopPropagation();
              setContextMenu(null);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu(null);
            }}
          />
          <div
            className="fl-clip__context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            data-testid={`clip-menu-${clip.id}`}
            {...menuOverlayProps}
          >
            <button
              type="button"
              className="fl-clip__context-menu-item"
              onClick={() => {
                onMakeUnique(clip.id);
                setContextMenu(null);
              }}
            >
              Make unique
            </button>
            <button
              type="button"
              className="fl-clip__context-menu-item"
              onClick={() => {
                onDelete(clip.id);
                setContextMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
