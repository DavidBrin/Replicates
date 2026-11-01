"use client";

import { Toggle } from "@/components/ui/Toggle";
import { portColour, portTag, useMatchConfig } from "@/lib/matchConfig";
import { setOwnStickJump, useOnlineStore } from "@/lib/onlineStore";
import { ROLE_PORT } from "@/net/signalProtocol";

/**
 * Per-player control options (Plan 5): Ultimate's "Stick Jump" — whether up on
 * the stick (or the up key) jumps. It changes what the simulation does with
 * the same keys, so it travels with the player's selection into the match,
 * and online to the other peer. CPUs play the default.
 *
 * Online (ruling R-T20a), this machine owns one port, the host P1 and the guest
 * P2, and only that one has a switch: the other port's option is the other
 * peer's, set by their pick. A change goes out in this machine's pick
 * (`setOwnStickJump`) and is kept for after the session.
 */
export function PlayerOptions() {
  const players = useMatchConfig((s) => s.players);
  const setStickJump = useMatchConfig((s) => s.setStickJump);
  const online = useMatchConfig((s) => s.online);
  const role = useOnlineStore((s) => s.role);
  const ownPort = role === null ? null : ROLE_PORT[role];
  const shown = online ? players.filter((p) => p.port === ownPort) : players.filter((p) => p.kind === "human");
  const change = (port: number, on: boolean) => {
    if (online) setOwnStickJump(on);
    else setStickJump(port, on);
  };

  return (
    <section aria-label="Player options" className="mt-5">
      <h2 className="font-display text-sm tracking-[0.14em] text-white/70 uppercase">Stick jump</h2>
      <ul className="mt-2 flex flex-wrap gap-4">
        {shown.map((p) => (
          <li key={p.port} className="flex items-center gap-3">
            <span className="font-display text-sm" style={{ color: portColour(p.port) }}>
              Player {p.port + 1}
            </span>
            <Toggle label={`${portTag(p.port)} stick jump`} checked={p.stickJump} onChange={(on) => change(p.port, on)} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/45">Off: up never jumps, so up specials and up tilts never leave the ground by accident.</p>
    </section>
  );
}
