"use client";

import { useState } from "react";

import { PixelButton } from "@/components/ui/PixelButton";
import { WoodPanel } from "@/components/ui/WoodPanel";

import { SettingsDialog } from "./SettingsDialog";

/**
 * Title / main menu (SPEC §7 `/`): the logo over a sky with pixel clouds and
 * a little island on the horizon, then a wood panel of the six mode buttons.
 * Phone-first: a single column that never exceeds 360 px.
 */
export const MENU_ENTRIES = [
  { label: "Campaign", href: "/campaign", variant: "green" as const },
  { label: "Random Map", href: "/random", variant: "yellow" as const },
  { label: "Hot-seat", href: "/hotseat", variant: "yellow" as const },
  { label: "Weekly Challenges", href: "/challenges", variant: "yellow" as const },
  { label: "Map Editor", href: "/editor", variant: "yellow" as const },
] as const;

export function TitleMenu() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <main className="ie-sky relative flex min-h-dvh flex-col items-center overflow-hidden px-4 pb-8 pt-10">
      <Clouds />
      <header className="relative z-10 mb-6 text-center">
        <h1 className="ie-outline ie-caps leading-[0.9]" style={{ fontSize: "clamp(2.6rem, 12vw, 4.5rem)" }}>
          Island
          <br />
          Empire
        </h1>
        <p className="ie-outline ie-caps mt-3 text-sm tracking-widest" style={{ color: "var(--ie-gold)" }}>
          Every move matters
        </p>
      </header>

      <WoodPanel className="relative z-10 w-full max-w-[360px]" footer="No luck. Only your skill counts.">
        <nav aria-label="Main menu" className="flex flex-col gap-3">
          {MENU_ENTRIES.map((entry) => (
            <PixelButton key={entry.href} href={entry.href} variant={entry.variant} size="lg" block>
              {entry.label}
            </PixelButton>
          ))}
          <PixelButton variant="wood" size="lg" block onClick={() => setSettingsOpen(true)}>
            Settings
          </PixelButton>
        </nav>
      </WoodPanel>

      <Horizon />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}

/** Blocky clouds, code-drawn (no assets, D18). */
function Clouds() {
  const cloud = (x: string, y: string, s: number, key: number) => (
    <svg
      key={key}
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left: x, top: y, width: 120 * s, height: 48 * s }}
      viewBox="0 0 30 12"
      shapeRendering="crispEdges"
    >
      <g fill="#ffffff">
        <rect x="4" y="6" width="22" height="4" />
        <rect x="8" y="3" width="10" height="3" />
        <rect x="11" y="1" width="5" height="2" />
        <rect x="19" y="4" width="6" height="2" />
        <rect x="2" y="8" width="26" height="2" />
      </g>
      <g fill="#cfe8fb">
        <rect x="2" y="10" width="26" height="1" />
      </g>
    </svg>
  );
  return (
    <>
      {cloud("-4%", "6%", 1.1, 0)}
      {cloud("62%", "12%", 0.8, 1)}
      {cloud("30%", "3%", 0.6, 2)}
      {cloud("74%", "34%", 1, 3)}
      {cloud("-8%", "42%", 0.7, 4)}
    </>
  );
}

/** Sea, a distant island with a pine cluster, and beach — the horizon strip. */
function Horizon() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-0 h-[34dvh] w-full"
      viewBox="0 0 400 160"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect x="0" y="70" width="400" height="90" fill="var(--ie-water)" />
      <g fill="var(--ie-water-shade)" opacity="0.7">
        <rect x="20" y="90" width="14" height="2" />
        <rect x="120" y="110" width="18" height="2" />
        <rect x="250" y="96" width="12" height="2" />
        <rect x="330" y="124" width="20" height="2" />
        <rect x="70" y="140" width="16" height="2" />
        <rect x="200" y="132" width="10" height="2" />
      </g>
      <g>
        <rect x="90" y="54" width="220" height="24" rx="6" fill="var(--ie-beach)" />
        <rect x="100" y="50" width="200" height="22" rx="6" fill="var(--ie-grass)" />
        <g fill="var(--ie-pine)">
          <polygon points="140,52 150,30 160,52" />
          <polygon points="158,52 168,26 178,52" />
          <polygon points="176,52 186,32 196,52" />
          <polygon points="230,52 240,34 250,52" />
        </g>
        <g fill="var(--ie-pine-shadow)">
          <polygon points="150,52 160,30 165,52" />
          <polygon points="168,52 178,26 183,52" />
          <polygon points="240,52 250,34 255,52" />
        </g>
        <rect x="205" y="40" width="12" height="12" fill="var(--ie-card-cream)" stroke="var(--ie-ink)" strokeWidth="1.5" />
        <polygon points="203,41 211,32 219,41" fill="var(--ie-p-blue)" stroke="var(--ie-ink)" strokeWidth="1.5" />
        <rect x="264" y="44" width="10" height="8" fill="var(--ie-mountain)" stroke="var(--ie-ink)" strokeWidth="1.2" />
        <rect x="272" y="40" width="12" height="12" fill="var(--ie-mountain-light)" stroke="var(--ie-ink)" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

export default TitleMenu;
