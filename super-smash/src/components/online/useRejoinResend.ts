import { useEffect } from "react";

import { sendHostStage, sendOwnPick, useOnlineStore } from "@/lib/onlineStore";

export interface RejoinResendOptions {
  /**
   * Repeat the host's stage as well. True once the host has chosen it
   * (character select); on stage select it is still being chosen, and goes
   * with Choose Fighters as the first time.
   */
  readonly stage: boolean;
}

/**
 * Whoever takes an empty seat starts from an empty page (lib/onlineStore), so
 * when the channel opens again this side repeats its own pick, from its own
 * match port (`localPort`), and — if asked — the host its stage. Every move into
 * `connected` counts, so each newcomer to a begun room's seat gets both.
 *
 * Only a transition into `connected` counts. Mounting says nothing: the select
 * screens are reached once the room is already open, from the lobby, before
 * anything was picked. A store subscription rather than an effect on the
 * status, so that a leave and a rejoin landing in one render still count.
 */
export function useRejoinResend({ stage }: RejoinResendOptions): void {
  const role = useOnlineStore((s) => s.role);

  useEffect(() => {
    if (role === null) return;
    return useOnlineStore.subscribe((now, before) => {
      if (now.status !== "connected" || before.status === "connected") return;
      // The port this machine plays, read as it moves in: the host's Start can have moved it off its room seat.
      if (now.localPort !== null) sendOwnPick(now.localPort);
      if (stage && role === "host") sendHostStage();
    });
  }, [role, stage]);
}
