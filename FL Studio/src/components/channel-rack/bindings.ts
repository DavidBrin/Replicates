"use client";

/**
 * Channel Rack keyboard bindings (SPEC §4.4, lane 1 §2.7, §9): `1..9,0` mute
 * channels 1–10, `↑/↓` select the channel above/below. Registered through
 * the shared binding registry (`src/lib/keyboard.ts`, owned by slice C) —
 * this module owns only *its own* bindings, per that file's contract.
 *
 * Solo (`Ctrl+1..9,0`) is intentionally out for v1: `Channel.muted` is the
 * only mute-family field in SPEC §2's `Channel`, and solo needs
 * cross-channel bookkeeping (which channels were already muted before the
 * solo) that has nowhere to live without a domain change slice D doesn't
 * own. Left as a follow-up rather than faked with a partial behaviour.
 */

import { updateChannel } from "@/domain/commands/channels";
import type { ChannelId } from "@/domain/types";
import { oneShotGestureKey } from "@/lib/gestureHold";
import { appStore } from "@/lib/store";
import { registerBindings, type KeyBinding } from "@/lib/keyboard";
import type { ChannelRackUiSlice } from "./uiState";

const SURFACE_ID = "channel-rack";

/** `1`-`9` then `0`, matching FL's "channel 1-10" ordering (lane 1 §2.7). */
const MUTE_KEY_CODES = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
];

export interface ChannelRackBindingsOptions {
  /** Test/override seam — defaults to reading `ChannelRackUiSlice` off the store. */
  getSelectedChannelId?: () => ChannelId | null;
  selectChannel?: (id: ChannelId) => void;
}

function readUiSlice(): Partial<ChannelRackUiSlice> {
  return appStore.getState() as unknown as Partial<ChannelRackUiSlice>;
}

function moveSelection(direction: 1 | -1, options: ChannelRackBindingsOptions): void {
  const { channelOrder } = appStore.getState().project;
  if (channelOrder.length === 0) return;

  const current = options.getSelectedChannelId?.() ?? readUiSlice().selectedChannelId ?? null;
  const currentIndex = current ? channelOrder.indexOf(current) : -1;
  const nextIndex =
    currentIndex === -1
      ? 0
      : (currentIndex + direction + channelOrder.length) % channelOrder.length;
  const nextChannelId = channelOrder[nextIndex];
  if (!nextChannelId) return;

  if (options.selectChannel) options.selectChannel(nextChannelId);
  else readUiSlice().selectChannel?.(nextChannelId);
}

/** Registers this surface's bindings; returns an unregister function. */
export function registerChannelRackBindings(
  options: ChannelRackBindingsOptions = {},
): () => void {
  const bindings: KeyBinding[] = MUTE_KEY_CODES.map((code, index) => ({
    id: `mute-channel-${index}`,
    code,
    description: `Mute channel ${index + 1}`,
    handler: () => {
      /*
       * A keyboard mutation is a gesture too, and it goes through the shared
       * one-shot path (`@/lib/gestureHold`) rather than straight to
       * `dispatch`.
       *
       * Dispatching bare bypassed the single-active-mutating-gesture
       * invariant in both directions: a knob drag or a rack paint stroke that
       * was open stayed open across the keystroke — still holding autosave
       * off, still coalescing — and this mute landed in the middle of it, so
       * one drag came back as two undo entries with a mute wedged between
       * them. `oneShotGestureKey` seals and releases whatever was in flight
       * and hands back the id this dispatch travels under; it takes no hold
       * of its own, because a keypress has no pointer-up coming (rule (e)).
       */
      /*
       * The lookup happens BEFORE the one-shot, because pre-empting is an
       * effect in its own right: it ends whatever drag is open app-wide and
       * flushes any open editor's commit. `8` in a seven-channel project maps
       * to no channel and mutes nothing — and it used to kill a knob drag the
       * user was still holding on its way to returning empty-handed. A key
       * that writes nothing pre-empts nothing.
       *
       * The state is then read AGAIN after the one-shot and the second read is
       * the one dispatched: the pre-emption commits a pending rename and can
       * end a gesture that was mid-write, so the channel's `muted` may not be
       * what the probe saw. (Both reads are guarded — a channel can be gone by
       * the second.)
       */
      const probe = appStore.getState().project;
      const probeId = probe.channelOrder[index];
      if (!probeId || !probe.channels[probeId]) return;

      const gestureId = oneShotGestureKey(`${SURFACE_ID}-mute`);
      const { project, dispatch } = appStore.getState();
      const channelId = project.channelOrder[index];
      if (!channelId) return;
      const channel = project.channels[channelId];
      if (!channel) return;
      dispatch(updateChannel(channelId, { muted: !channel.muted }), { gestureId });
    },
  }));

  bindings.push(
    {
      id: "select-channel-up",
      code: "ArrowUp",
      description: "Select channel above",
      handler: () => moveSelection(-1, options),
    },
    {
      id: "select-channel-down",
      code: "ArrowDown",
      description: "Select channel below",
      handler: () => moveSelection(1, options),
    },
  );

  return registerBindings(SURFACE_ID, bindings);
}
