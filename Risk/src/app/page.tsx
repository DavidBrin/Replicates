"use client";

/**
 * Home (SPEC §7, `/`).
 *
 * A dark teal-navy field with a faintly ghosted world map, a radial sunburst
 * behind a gold-framed circular avatar, the name and colour chip below, and
 * the huge green `BATTLE` pill (~290×72) that leads to `/new`.
 *
 * **No shop, no news, no rank** — three things the original's home screen is
 * mostly made of and none of which this replica has.
 *
 * The identity sheet opens on first arrival (no cached identity) and is
 * re-openable from the small ⚙ affordance. `localStorage` is read in an
 * effect, never during render, so the server and the first client paint
 * agree.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { createIdentityAdapter } from "@/adapters/localStorage/identity";
import type { PlayerColour } from "@/engine/types";
import type { Identity } from "@/ports/identity";

import { IdentitySheet } from "@/components/setup/IdentitySheet";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";
import { Pill } from "@/components/ui/Pill";

/** Chunky, deliberately imprecise landmasses — a ghost, not a map (§8). */
const GHOST_LAND = [
  "M60 120 L200 96 L300 150 L268 232 L150 262 L72 212 Z",
  "M196 290 L268 272 L300 350 L258 440 L206 420 L186 350 Z",
  "M430 92 L540 78 L556 130 L498 168 L432 150 Z",
  "M448 190 L556 176 L596 270 L540 400 L470 392 L440 290 Z",
  "M600 80 L860 66 L900 170 L800 260 L650 230 L596 150 Z",
  "M780 300 L880 288 L900 360 L810 386 L766 350 Z",
];

/** `useIsClient`: a stable-snapshot external store, so the cached identity is
 *  read on the client only and the server's markup never disagrees. */
const NEVER = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

export default function HomePage() {
  const router = useRouter();
  const identity = useMemo(() => createIdentityAdapter(), []);
  const mounted = useSyncExternalStore(NEVER, ON_CLIENT, ON_SERVER);
  /** Set by the sheet when it claims; otherwise the adapter's cache answers. */
  const [claimed, setClaimed] = useState<{ displayName: string; colour: PlayerColour } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const stored = mounted ? identity.readCached() : null;
  const cached = claimed ?? (stored ? { displayName: stored.displayName, colour: stored.colour } : null);
  const ready = mounted;

  const colour: PlayerColour = cached?.colour ?? "red";
  const name = cached?.displayName ?? "Commander";
  const showSheet = ready && (cached === null || sheetOpen);

  function onDone(next: Identity) {
    setClaimed({ displayName: next.displayName, colour: next.colour });
    setSheetOpen(false);
  }

  return (
    <main
      data-testid="home-screen"
      className="relative flex min-h-dvh flex-1 flex-col items-center justify-center overflow-hidden px-4 py-8"
      style={{ background: "radial-gradient(circle at 50% 42%, var(--chrome-900) 0%, var(--ocean-deep) 100%)" }}
    >
      {/* the faintly ghosted world map */}
      <svg
        data-testid="home-ghost-map"
        aria-hidden
        viewBox="0 0 960 500"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ opacity: 0.08 }}
      >
        {GHOST_LAND.map((d) => (
          <path key={d} d={d} fill="var(--ocean-glow)" />
        ))}
      </svg>

      {/* the radial sunburst behind the portrait */}
      <div
        data-testid="home-sunburst"
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[34%] h-[min(78vh,620px)] w-[min(78vh,620px)] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: `repeating-conic-gradient(from 0deg, var(--p-${colour}) 0deg 6deg, transparent 6deg 12deg)`,
          opacity: 0.22,
          maskImage: "radial-gradient(circle, #000 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(circle, #000 0%, transparent 70%)",
        }}
      />

      <div className="absolute left-3 top-3 flex gap-2">
        <IconButton
          icon="gear"
          label="Settings"
          chassis="outline"
          size={44}
          testId="home-settings"
          onClick={() => setSheetOpen(true)}
        />
      </div>

      <div className="relative flex flex-col items-center gap-5">
        {/* the gold-framed circular avatar */}
        <div
          className="rounded-full p-[6px]"
          style={{ background: "linear-gradient(var(--gold), #9A7A07)", boxShadow: "var(--sh-float)" }}
        >
          <Avatar name={name} colour={colour} size={148} testId="home-avatar" />
        </div>

        <div className="flex items-center gap-3">
          <span
            data-testid="home-colour"
            aria-hidden
            className="inline-block rounded-full"
            style={{ width: 22, height: 22, background: `var(--p-${colour})`, border: "2px solid var(--text)" }}
          />
          <span data-testid="home-name" className="on-board-text" style={{ fontSize: "clamp(24px, 4vw, 42px)" }}>
            {name}
          </span>
        </div>

        <Pill label="BATTLE" size="hero" testId="home-battle" onClick={() => router.push("/new")} />
      </div>

      {showSheet ? (
        <IdentitySheet
          identity={identity}
          onDone={onDone}
          onCancel={cached ? () => setSheetOpen(false) : undefined}
        />
      ) : null}
    </main>
  );
}
