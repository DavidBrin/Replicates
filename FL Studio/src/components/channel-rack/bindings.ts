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
      const { project, dispatch } = appStore.getState();
      const channelId = project.channelOrder[index];
      if (!channelId) return;
      const channel = project.channels[channelId];
      if (!channel) return;
      dispatch(updateChannel(channelId, { muted: !channel.muted }));
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
