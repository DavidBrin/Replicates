"use client";

import "./shell.css";

import { useEffect, useState } from "react";

import { TransportBar } from "@/components/transport/TransportBar";
import {
  attachKeyboardListener,
  registerBindings,
} from "@/lib/keyboard";
import {
  redo,
  selectAdjacentPattern,
  togglePlaybackMode,
  togglePlayStop,
  undo,
} from "@/components/shell/wiring";
import { WindowPanel } from "@/components/shell/WindowPanel";
import {
  ChannelRackSlot,
  MixerSlot,
  PianoRollSlot,
  PlaylistSlot,
} from "@/components/shell/windowSlots";

type RackTab = "rack" | "roll";

const GLOBAL_SURFACE_ID = "shell:global";

export interface AppShellProps {
  /** Test seam: skip attaching the real `window` keydown listener. */
  attachGlobalListener?: boolean;
}

/**
 * Fixed docked layout shell (SPEC §4.1): one toolbar over a fixed grid —
 * Playlist top-left (wide), Mixer as a right rail, Channel Rack ⇄ Piano
 * Roll as a tabbed region under the Playlist. No floating/draggable
 * windows. Layout/focus state (visibility, active tab) is ephemeral UI
 * state, never persisted (SPEC §4.1 closing line).
 */
export function AppShell({ attachGlobalListener = true }: AppShellProps) {
  const [playlistVisible, setPlaylistVisible] = useState(true);
  const [mixerVisible, setMixerVisible] = useState(true);
  const [rackTab, setRackTab] = useState<RackTab>("rack");

  useEffect(() => {
    const unregister = registerBindings(GLOBAL_SURFACE_ID, [
      {
        id: "play-stop",
        code: "Space",
        handler: () => {
          void togglePlayStop();
        },
      },
      {
        id: "mode-toggle",
        code: "KeyL",
        handler: () => togglePlaybackMode(),
      },
      {
        id: "toggle-playlist",
        code: "F5",
        handler: () => setPlaylistVisible((visible) => !visible),
      },
      {
        id: "focus-rack",
        code: "F6",
        handler: () => setRackTab("rack"),
      },
      {
        id: "focus-roll",
        code: "F7",
        handler: () => setRackTab("roll"),
      },
      {
        id: "toggle-mixer",
        code: "F9",
        handler: () => setMixerVisible((visible) => !visible),
      },
      {
        id: "undo",
        code: "KeyZ",
        ctrl: true,
        handler: () => undo(),
      },
      {
        id: "redo-shift-z",
        code: "KeyZ",
        ctrl: true,
        shift: true,
        handler: () => redo(),
      },
      {
        id: "redo-y",
        code: "KeyY",
        ctrl: true,
        handler: () => redo(),
      },
      {
        id: "next-pattern",
        code: "NumpadAdd",
        handler: () => selectAdjacentPattern(1),
      },
      {
        id: "prev-pattern",
        code: "NumpadSubtract",
        handler: () => selectAdjacentPattern(-1),
      },
    ]);

    return unregister;
  }, []);

  useEffect(() => {
    if (!attachGlobalListener) return;
    return attachKeyboardListener(window);
  }, [attachGlobalListener]);

  return (
    <div className="fl-app-shell">
      <TransportBar />
      <div className="fl-workspace">
        <div className="fl-workspace__column">
          {playlistVisible && (
            <WindowPanel title="Playlist" className="fl-window--playlist">
              <PlaylistSlot />
            </WindowPanel>
          )}
          <WindowPanel
            title={
              rackTab === "rack" ? "Channel rack" : "Piano roll - Untitled"
            }
            className="fl-window--rack-roll"
            tabs={[
              { id: "rack", label: "Rack (F6)" },
              { id: "roll", label: "Roll (F7)" },
            ]}
            activeTabId={rackTab}
            onTabChange={(id) => setRackTab(id as RackTab)}
          >
            {rackTab === "rack" ? <ChannelRackSlot /> : <PianoRollSlot />}
          </WindowPanel>
        </div>
        {mixerVisible && (
          <div className="fl-workspace__rail">
            <WindowPanel title="Mixer - return to new" className="fl-window--mixer">
              <MixerSlot />
            </WindowPanel>
          </div>
        )}
      </div>
    </div>
  );
}
