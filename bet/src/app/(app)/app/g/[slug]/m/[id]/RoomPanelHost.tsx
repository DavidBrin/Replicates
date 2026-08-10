"use client";

/**
 * Composition seam for the Room's realtime transport (G1).
 *
 * `RoomPanel` lives in `src/components/**`, which must never import
 * `src/adapters/**`, so it programs against the `RealtimeChannel` port and
 * takes the transport as a `createChannel` prop. The market page that
 * renders it is a *Server* Component, and a function can't cross the
 * server→client boundary as a prop — so this tiny `"use client"` host, which
 * lives under `src/app/**` (where importing an adapter is allowed), is where
 * the port meets its implementation. Swapping polling for SSE is a one-line
 * change here and nowhere else.
 *
 * `createPollingRealtimeChannel` is a module-level function, so the
 * reference is stable across renders and `RoomPanel`'s channel effect
 * doesn't tear down and rebuild the channel on every re-render.
 */

import { createPollingRealtimeChannel } from "@/adapters/realtime/polling";
import { RoomPanel, type RoomPanelProps } from "@/components/room/RoomPanel";

export type RoomPanelHostProps = Omit<RoomPanelProps, "createChannel">;

export function RoomPanelHost(props: RoomPanelHostProps) {
  return <RoomPanel {...props} createChannel={createPollingRealtimeChannel} />;
}
