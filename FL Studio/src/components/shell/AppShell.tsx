"use client";

import "./shell.css";

import { useCallback, useEffect, useState } from "react";

import { ChannelRack } from "@/components/channel-rack/ChannelRack";
import { registerChannelRackBindings } from "@/components/channel-rack/bindings";
import { Mixer } from "@/components/mixer/Mixer";
import { PianoRoll } from "@/components/piano-roll/PianoRoll";
import { Playlist } from "@/components/playlist/Playlist";
import { TransportBar } from "@/components/transport/TransportBar";
import {
  attachKeyboardListener,
  registerBindings,
} from "@/lib/keyboard";
import { useAppStore } from "@/lib/store";
import {
  getPlayheadTick,
  installE2eHook,
  redo,
  selectAdjacentPattern,
  startShellRuntime,
  toggleMetronome,
  togglePlaybackMode,
  togglePlayStop,
  undo,
  usePlayheadTicks,
} from "@/components/shell/wiring";
import { WindowPanel } from "@/components/shell/WindowPanel";

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
 *
 * The shell is also where the two **cross-surface** actions land, because it
 * owns the one piece of state both need — `rackTab`. The Channel Rack fires a
 * one-shot `pianoRollRequestChannelId` when a channel name is clicked; the
 * Playlist hands up a pattern id on a clip double-click. Neither surface can
 * reach the other, and neither has to.
 */
export function AppShell({ attachGlobalListener = true }: AppShellProps) {
  const [playlistVisible, setPlaylistVisible] = useState(true);
  const [mixerVisible, setMixerVisible] = useState(true);
  const [rackTab, setRackTab] = useState<RackTab>("rack");

  const playbackMode = useAppStore((state) => state.project.playbackMode);
  const songPlayheadTicks = usePlayheadTicks(playbackMode === "song");

  // Hydrate from storage, feed the engine, start autosave — once, on mount.
  useEffect(() => startShellRuntime(), []);
  useEffect(() => installE2eHook(), []);

  /* ------------------------------------------- cross-surface: open roll -- */

  // Subscribed imperatively rather than selected into render: the request is
  // a one-shot *event*, and consuming it from an effect that reacts to a
  // rendered value means rendering one frame of a state we are about to
  // change anyway.
  useEffect(
    () =>
      useAppStore.subscribe((state, previous) => {
        const requested = state.pianoRollRequestChannelId;
        if (requested === null || requested === previous.pianoRollRequestChannelId) return;
        state.setPianoRollChannel(requested);
        setRackTab("roll");
        state.clearPianoRollRequest();
      }),
    [],
  );

  const openPatternInRoll = useCallback((patternId: string) => {
    useAppStore.getState().setActivePatternId(patternId);
    setRackTab("roll");
  }, []);

  /* ----------------------------------------------------- key bindings --- */

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
        id: "metronome",
        code: "KeyM",
        ctrl: true,
        handler: () => toggleMetronome(),
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

  // Each surface registers its OWN bindings through the same registry
  // (SPEC §6): the rack's mute digits and ↑/↓ selection here, the roll's from
  // inside `PianoRoll.tsx`'s own mount effect.
  useEffect(() => registerChannelRackBindings(), []);

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
              <Playlist
                playheadTicks={songPlayheadTicks}
                onOpenPianoRoll={openPatternInRoll}
              />
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
            {rackTab === "rack" ? (
              <ChannelRack />
            ) : (
              <PianoRoll getPlayheadTick={getPlayheadTick} />
            )}
          </WindowPanel>
        </div>
        {mixerVisible && (
          <div className="fl-workspace__rail">
            <WindowPanel title="Mixer - return to new" className="fl-window--mixer">
              <Mixer />
            </WindowPanel>
          </div>
        )}
      </div>
    </div>
  );
}
