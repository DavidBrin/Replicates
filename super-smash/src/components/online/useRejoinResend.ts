import { useEffect } from "react";

import { sendHostStage, sendOwnPick, useOnlineStore } from "@/lib/onlineStore";
import { ROLE_PORT } from "@/net/signalProtocol";

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
 * when the channel opens again this side repeats its own pick, and — if asked
 * — the host its stage.
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
    const port = ROLE_PORT[role];
    return useOnlineStore.subscribe((now, before) => {
      if (now.status !== "connected" || before.status === "connected") return;
      sendOwnPick(port);
      if (stage && role === "host") sendHostStage();
    });
  }, [role, stage]);
}
