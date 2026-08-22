"use client";

import "./channelRack.css";

import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { addChannel, moveChannel, notesAtStep, removeChannel, updateChannel, updateNotes, updateProject } from "@/domain/commands";
import type { Command } from "@/domain/commands/types";
import { nextId } from "@/domain/ids";
import { colorAt, PALETTE } from "@/domain/palette";
import { MASTER_MIXER_TRACK_ID, type Channel, type ChannelId, type Pattern, type VoiceKind } from "@/domain/types";
import { commitGestureKey, oneShotGestureKey, useGestureSession, wheelEditKey } from "@/lib/gestureHold";
import { handleRangeInputKeyDown } from "@/lib/keyboard";
import { createWheelGestureKeyring, type WheelGestureKeyring } from "@/lib/wheelGesture";
import {
  selectActivePattern,
  selectChannels,
  selectGlobalSwing,
  selectProjectRevision,
  selectMixerTracks,
  useAppStore,
} from "@/lib/store";
import { ChannelRackRow } from "./ChannelRackRow";
import { usePlayheadStep } from "./uiState";

const VELOCITY_STEP = 1 / 32;
/**
 * How close two velocities have to be before a nudge is a NO-OP — `Knob`'s
 * epsilon, restated rather than imported for the reason `mixer/Fader.tsx`
 * gives: these are floats, and a value the clamp has already pinned to 0 or 1
 * must not file an undo entry that undoes nothing.
 */
const VELOCITY_NO_OP_EPSILON = 1e-9;

/** Human labels for the add-channel picker (mirrors `defaultProject`'s seed names). */
const VOICE_LABELS: Record<VoiceKind, string> = {
  kick: "Kick",
  clap: "Clap",
  hatClosed: "Closed hat",
  hatOpen: "Open hat",
  snare: "Snare",
  bass: "Bass",
  lead: "Lead",
};

const VOICE_ORDER: readonly VoiceKind[] = ["kick", "clap", "hatClosed", "hatOpen", "snare", "bass", "lead"];
const MELODIC_DEFAULT_PITCH: Partial<Record<VoiceKind, number>> = { bass: 36, lead: 72 };

export interface ChannelRackProps {
  /** Test/override seam, mirroring `TransportBar`'s callback-prop pattern. */
  onSelectChannel?: (id: ChannelId) => void;
  onOpenPianoRoll?: (id: ChannelId) => void;
}

/**
 * The Channel Rack window (SPEC §1.1, §4.1's tabbed rack/roll region). Rows,
 * per-channel controls and the 16-step grid all read/write through
 * `store.dispatch` — no domain field is ever written directly (SPEC §5).
 *
 * `ChannelRackUiSlice` is registered in the composer (SPEC §5, §8), so
 * selection and the one-shot "open the roll for this channel" request are
 * read and written straight through `useAppStore` — there is no local mirror
 * of either. The shell consumes `pianoRollRequestChannelId` and clears it.
 */
export function ChannelRack({ onSelectChannel, onOpenPianoRoll }: ChannelRackProps = {}) {
  // `selectChannels`/`selectMixerTracks` build a fresh array each call
  // (store.ts's own docstring: "must be used with useShallow, or read
  // through a stable primitive selector — they cannot be compared by
  // identity"), so they're wrapped here to avoid a `useSyncExternalStore`
  // re-render loop.
  const channels = useAppStore(useShallow(selectChannels));
  const pattern = useAppStore(selectActivePattern);
  const mixerTracks = useAppStore(useShallow(selectMixerTracks));
  const globalSwing = useAppStore(selectGlobalSwing);
  // Every buffered paint stroke is dropped when this moves — undo, redo, or a
  // wholesale project replacement. See `ChannelRackRow`'s
  // `PaintSession.projectRevision`.
  const projectRevision = useAppStore(selectProjectRevision);
  const dispatch = useAppStore((state) => state.dispatch);
  const project = useAppStore((state) => state.project);

  const selectedChannelId = useAppStore((state) => state.selectedChannelId);
  const selectChannel = useAppStore((state) => state.selectChannel);
  const requestOpenPianoRoll = useAppStore((state) => state.requestOpenPianoRoll);
  const playheadStep = usePlayheadStep();
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // The Alt+wheel step-velocity keyring — one per mounted rack, built lazily
  // so a re-render does not allocate another. See `handleVelocityNudge`.
  const velocityWheelRef = useRef<WheelGestureKeyring | null>(null);
  const velocityWheel = (velocityWheelRef.current ??= createWheelGestureKeyring("rack-velocity"));

  /**
   * The rack swing slider's gesture (`@/lib/gestureHold`), which owns three
   * things at once: the persistence hold, the per-drag `coalesceKey`, and
   * every terminator a drag can end on (pointerup, pointercancel, blur,
   * unmount).
   *
   * The key must be fresh per drag, not a fixed string — a fixed key folds
   * every swing drag the session ever made into one undo entry. It must also
   * come from a MODULE-level counter rather than the component-local `useRef`
   * this used to keep: the rack remounts on a tab flip, the ref restarted at
   * 1, and the second mount's first drag re-minted `rack-swing#1` and welded
   * itself onto the first mount's undo entry. A keyboard arrow with no drag
   * open takes a fresh one-shot key from `keyFor`, so it can never join the
   * drag before it either.
   */
  const swing = useGestureSession("rack-swing");

  if (!pattern) return null;
  // Nested function declarations below don't inherit the narrowing above
  // (TS doesn't carry control-flow narrowing into closures) — an explicitly
  // typed alias sidesteps that without an `!` assertion at every call site.
  const activePattern: Pattern = pattern;

  function handleSelect(channelId: ChannelId): void {
    onSelectChannel?.(channelId);
    selectChannel(channelId);
  }

  function handleOpenPianoRoll(channelId: ChannelId): void {
    onOpenPianoRoll?.(channelId);
    requestOpenPianoRoll(channelId);
  }

  /**
   * Every mutation below is a CLICK — one press, committed on the spot, with
   * no drag to bound it — so each takes a one-shot gesture key
   * (`@/lib/gestureHold`'s `oneShotGestureKey`) rather than dispatching bare.
   *
   * A bare dispatch is invisible to the gesture registry, and that is the bug:
   * the click lands while some other surface still has a gesture open (a knob
   * held with the other hand, a paint stroke whose release was swallowed, a
   * clip drag), and that gesture stays open across it — still holding off
   * autosave, still extending its own undo entry with an edit it never made.
   * The one-shot seals it first, then names this edit's own entry. It takes no
   * hold of its own: there is no pointer-up coming.
   */
  function handleToggleMute(channelId: ChannelId): void {
    const channel = project.channels[channelId];
    if (!channel) return;
    dispatch(updateChannel(channelId, { muted: !channel.muted }), {
      gestureId: oneShotGestureKey("rack-mute"),
    });
  }

  function handleKnobChange(
    channelId: ChannelId,
    patch: { pan?: number } | { volume?: number },
    coalesceKey: string,
  ): void {
    dispatch(updateChannel(channelId, patch), { coalesceKey });
  }

  function handleCycleRouting(channelId: ChannelId, direction: 1 | -1): void {
    const channel = project.channels[channelId];
    if (!channel || mixerTracks.length === 0) return;
    const order = mixerTracks.map((track) => track.id);
    const currentIndex = order.indexOf(channel.routedToMixerTrackId);
    const nextIndex = (currentIndex + direction + order.length) % order.length;
    const nextTrackId = order[nextIndex];
    if (nextTrackId) {
      dispatch(updateChannel(channelId, { routedToMixerTrackId: nextTrackId }), {
        gestureId: oneShotGestureKey("rack-routing"),
      });
    }
  }

  /**
   * The whole paint stroke (a single click included) arrives pre-built as
   * one command — see `ChannelRackRow`'s doc comment for why that command is
   * built row-side instead of dispatched cell-by-cell with a `coalesceKey`.
   */
  /**
   * A paint stroke's buffered command lands here on pointer-up, and by then
   * the pattern it was built against may be gone — `Ctrl+Z` undoing the
   * pattern's creation while the button is still down is the reachable case,
   * and the dispatch threw `CommandError` out of a pointer handler.
   *
   * The row dropping its own buffer the moment it is re-rendered with a
   * different pattern is the mechanism that actually fires, and the one the
   * tests pin (`ChannelRackRow.tsx`). This is belt and braces underneath it,
   * deliberately asking the LIVE store rather than the rendered snapshot so it
   * still holds for any future caller the row's re-render does not reach — a
   * memoized row, or a commit driven from outside React. No test can
   * distinguish it today: React always flushes the row's re-render before the
   * release arrives, so the row's own check gets there first.
   */
  function handleCommitSteps(command: Command): void {
    const live = useAppStore.getState().project;
    if (live.patterns[activePattern.id] === undefined) return;
    dispatch(command);
  }

  /**
   * Alt+wheel over a step nudges its velocity — and, like the piano roll's
   * identical gesture, it has no pointer-up to close the undo entry.
   *
   * The key used to be the fixed `velocity:<channel>:<step>`, which never
   * closes: nudging one cell, editing elsewhere for a minute, then nudging
   * the same cell again folded both sessions into a single Ctrl+Z. The
   * shared keyring bounds them the way the roll does — same cell within
   * WHEEL_GESTURE_GAP_MS is one entry, a pause or a different cell is a new
   * one (`@/lib/wheelGesture`).
   */
  function handleVelocityNudge(channelId: ChannelId, step: number, direction: 1 | -1): void {
    const existing = notesAtStep(activePattern, channelId, step);
    if (existing.length === 0) return;
    /*
     * The nudge is CLAMPED, so at either end of the range it produces the
     * velocity the note already has. Dispatching that filed an undo entry
     * that undoes nothing — and, worse, `wheelEditKey` below PRE-EMPTS, so a
     * notch at the ceiling sealed a knob or clip drag somebody was still
     * holding for an edit that never happened. Nothing changed means nothing
     * dispatched and nothing pre-empted.
     *
     * Epsilon rather than `===`: velocities are floats (`Knob`'s rule).
     */
    const patches = existing
      .map((note) => ({
        id: note.id,
        velocity: Math.min(1, Math.max(0, note.velocity + direction * VELOCITY_STEP)),
        current: note.velocity,
      }))
      .filter((patch) => Math.abs(patch.velocity - patch.current) > VELOCITY_NO_OP_EPSILON);
    if (patches.length === 0) return;
    dispatch(
      updateNotes(
        activePattern.id,
        patches.map(({ id, velocity }) => ({ id, patch: { velocity } })),
      ),
      // `wheelEditKey`, not the keyring alone: a wheel edit is a mutating
      // gesture, so it seals whatever drag is open elsewhere in the app before
      // it lands (`@/lib/gestureHold`). Nudging a step's velocity while a knob
      // or a clip was still held used to leave that drag open across the edit,
      // extending its undo entry with a change it never made. The KEY is still
      // the keyring's — that is what bounds a run of notches into one entry —
      // and the target is a tuple, not a hand-joined string, since ids may
      // contain the separator (`wheelGesture.ts`'s `encodeTarget`).
      { coalesceKey: wheelEditKey(velocityWheel, [activePattern.id, channelId, step]) },
    );
  }

  function handleAddChannel(voice: VoiceKind): void {
    const channel: Channel = {
      id: nextId("channel"),
      name: VOICE_LABELS[voice],
      color: colorAt(channels.length),
      voice,
      volume: 0.8,
      pan: 0,
      muted: false,
      defaultStepPitch: MELODIC_DEFAULT_PITCH[voice] ?? 60,
      routedToMixerTrackId: MASTER_MIXER_TRACK_ID,
    };
    dispatch(addChannel(channel), { gestureId: oneShotGestureKey("rack-add-channel") });
    setAddMenuOpen(false);
  }

  /**
   * A BLUR COMMIT (`ChannelRackRow`'s rename box commits when focus leaves
   * it), so it takes the non-pre-empting key — `blur` is delivered after the
   * `pointerdown` that moved the focus, and a pre-empting one-shot ended the
   * gesture that press had just opened. See `@/lib/gestureHold`'s
   * `commitGestureKey`.
   *
   * The no-op rename dispatches nothing: the row already refuses a blank or
   * unchanged name, and this repeats the check so the property survives a
   * second caller.
   */
  function handleRenameChannel(channelId: ChannelId, name: string): void {
    if (project.channels[channelId]?.name === name) return;
    dispatch(updateChannel(channelId, { name }), { gestureId: commitGestureKey("rack-rename") });
  }

  function handleDeleteChannel(channelId: ChannelId): void {
    dispatch(removeChannel(channelId), { gestureId: oneShotGestureKey("rack-delete") });
  }

  function handleRecolorChannel(channelId: ChannelId): void {
    const channel = project.channels[channelId];
    if (!channel) return;
    const currentIndex = PALETTE.indexOf(channel.color);
    const nextIndex = (currentIndex + 1 + PALETTE.length) % PALETTE.length;
    dispatch(updateChannel(channelId, { color: colorAt(nextIndex) }), {
      gestureId: oneShotGestureKey("rack-recolor"),
    });
  }

  function handleMoveChannel(channelId: ChannelId, direction: 1 | -1): void {
    const currentIndex = project.channelOrder.indexOf(channelId);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= project.channelOrder.length) return;
    dispatch(moveChannel(channelId, nextIndex), { gestureId: oneShotGestureKey("rack-move") });
  }

  return (
    <div className="fl-channel-rack">
      <div className="fl-channel-rack__header">
        <label className="fl-channel-rack__swing">
          Swing
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={globalSwing}
            aria-label="Rack swing"
            // A range slider is NOT text entry, so the global registry now runs
            // from it (`@/lib/keyboard`) — `Ctrl+Z`/`Ctrl+S`/`Space` used to be
            // dead for as long as this slider kept focus. The arrow/Home/End
            // keys the slider itself acts on are stopped here instead, which
            // is the narrow half of that trade.
            onKeyDown={handleRangeInputKeyDown}
            onPointerDown={swing.begin}
            {...swing.terminators}
            // `keyForEdit`: a drag's edits carry the open session's id (the
            // pointer-down took the hold), a keyboard edit carries a
            // time-bounded one-shot key and takes NO hold. `begin()` here used
            // to open a hold on an arrow press whose only terminator is
            // `blur` — nudge the slider, leave it focused, and autosave was
            // deferred for the rest of the session. `terminators` still closes
            // the pointer drag on blur, pointer-cancel or unmount.
            /*
             * No no-op guard here, unlike every other clamped continuous path
             * in this app (round 15 #3's sweep) — a NATIVE range input cannot
             * produce one. It fires no `change` for a value it already holds,
             * so a drag pinned at 0 or 1 is silent at the DOM level rather
             * than at ours, and it coerces an invalid value to a valid one
             * rather than handing over `NaN`. The paths that DO need the
             * guard are the ones that compute their own value from pointer
             * travel: `Knob`, `Fader`, `BpmLcd`, the velocity nudges.
             */
            onChange={(event) =>
              dispatch(updateProject({ globalSwing: Number.parseFloat(event.target.value) }), {
                coalesceKey: swing.keyForEdit(),
              })
            }
          />
        </label>
        <span className="fl-channel-rack__pattern-length" aria-label="Pattern length in steps">
          16
        </span>
      </div>

      <div className="fl-channel-rack__rows">
        {channels.map((channel, index) => (
          <ChannelRackRow
            key={channel.id}
            channel={channel}
            pattern={activePattern}
            isSelected={selectedChannelId === channel.id}
            playheadStep={playheadStep}
            routedTrack={project.mixerTracks[channel.routedToMixerTrackId]}
            onToggleMute={() => handleToggleMute(channel.id)}
            onSelect={() => handleSelect(channel.id)}
            onOpenPianoRoll={() => handleOpenPianoRoll(channel.id)}
            onKnobChange={(patch, coalesceKey) => handleKnobChange(channel.id, patch, coalesceKey)}
            onCycleRouting={(direction) => handleCycleRouting(channel.id, direction)}
            onCommitSteps={handleCommitSteps}
            onVelocityNudge={(step, direction) => handleVelocityNudge(channel.id, step, direction)}
            onRename={(name) => handleRenameChannel(channel.id, name)}
            onDelete={() => handleDeleteChannel(channel.id)}
            onRecolor={() => handleRecolorChannel(channel.id)}
            onMoveUp={() => handleMoveChannel(channel.id, -1)}
            onMoveDown={() => handleMoveChannel(channel.id, 1)}
            projectRevision={projectRevision}
            canMoveUp={index > 0}
            canMoveDown={index < channels.length - 1}
          />
        ))}
      </div>

      <div className="fl-channel-rack__add-row">
        <button
          type="button"
          className="fl-channel-rack__add"
          data-testid="channel-add-button"
          aria-label="Add channel"
          aria-haspopup="menu"
          aria-expanded={addMenuOpen}
          onClick={() => setAddMenuOpen((open) => !open)}
        >
          +
        </button>
        {addMenuOpen && (
          <>
            <div className="fl-rack-menu__scrim" onClick={() => setAddMenuOpen(false)} />
            <div className="fl-rack-menu fl-rack-menu--add" role="menu" data-testid="channel-add-menu">
              {VOICE_ORDER.map((voice) => (
                <button type="button" role="menuitem" key={voice} onClick={() => handleAddChannel(voice)}>
                  {VOICE_LABELS[voice]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
