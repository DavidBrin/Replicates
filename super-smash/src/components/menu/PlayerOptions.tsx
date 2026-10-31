"use client";

import { Toggle } from "@/components/ui/Toggle";
import { portColour, portTag, useMatchConfig } from "@/lib/matchConfig";

/**
 * Per-player control options (Plan 5): Ultimate's "Stick Jump" — whether up on
 * the stick (or the up key) jumps. It changes what the simulation does with
 * the same keys, so it travels with the player's selection into the match,
 * and online to the other peer. CPUs play the default.
 */
export function PlayerOptions() {
  const players = useMatchConfig((s) => s.players);
  const setStickJump = useMatchConfig((s) => s.setStickJump);
  const humans = players.filter((p) => p.kind === "human");

  return (
    <section aria-label="Player options" className="mt-5">
      <h2 className="font-display text-sm tracking-[0.14em] text-white/70 uppercase">Stick jump</h2>
      <ul className="mt-2 flex flex-wrap gap-4">
        {humans.map((p) => (
          <li key={p.port} className="flex items-center gap-3">
            <span className="font-display text-sm" style={{ color: portColour(p.port) }}>
              Player {p.port + 1}
            </span>
            <Toggle label={`${portTag(p.port)} stick jump`} checked={p.stickJump} onChange={(on) => setStickJump(p.port, on)} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/45">Off: up never jumps, so up specials and up tilts never leave the ground by accident.</p>
    </section>
  );
}
