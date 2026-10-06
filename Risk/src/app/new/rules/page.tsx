"use client";

/**
 * `Modes and Modifiers` (SPEC §7, `/new/rules`).
 *
 * The chosen map as a 3D tilted hero with a player-count chip overlapping its
 * bottom edge and a red mode plate carrying a dark `CUSTOM` sub-chip; the
 * three-line rules readout beneath it; the right-hand vertical stack of
 * 68×68 modifier toggles; and the `Modifiers` button that opens the per-seat
 * panel. Green `BATTLE` sets `ready` and routes into the game.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { MAX_SEATS, type Rules } from "@/engine/types";
import { ModifiersPanel } from "@/components/setup/ModifiersPanel";
import { ModifierToggle } from "@/components/setup/ModifierToggle";
import { MapTile } from "@/components/setup/MapTile";
import { RulesReadout } from "@/components/setup/RulesReadout";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { SETUP_TOKENS } from "@/components/ui/tokens";
import { sessionConfigStore, useSessionConfig } from "@/game/sessionConfig";
import { createIdentityAdapter } from "@/adapters/localStorage/identity";
import { createLobby } from "@/components/online/createLobby";

interface ModifierSpec {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  readonly on: (rules: Rules) => boolean;
  readonly set: (on: boolean) => Partial<Rules>;
}

/** The eight toggles of §7, in the published order. */
const MODIFIERS: readonly ModifierSpec[] = [
  { key: "blizzards", label: "Blizzards", icon: "snowflake", on: (r) => r.blizzards, set: (on) => ({ blizzards: on }) },
  { key: "fog-of-war", label: "Fog of War", icon: "question", on: (r) => r.fogOfWar, set: (on) => ({ fogOfWar: on }) },
  { key: "portals", label: "Portals", icon: "portal", on: (r) => r.portals !== "off", set: (on) => ({ portals: on ? "stable" : "off" }) },
  { key: "capitals", label: "Capitals", icon: "capital", on: (r) => r.capitals, set: (on) => ({ capitals: on }) },
  {
    key: "percentage-domination",
    label: "Percentage Domination",
    icon: "percent",
    on: (r) => r.winCondition === "percentage",
    set: (on) => ({ winCondition: on ? "percentage" : "world" }),
  },
  { key: "manual-placement", label: "Manual Placement", icon: "map-pin", on: (r) => r.manualPlacement, set: (on) => ({ manualPlacement: on }) },
  { key: "max-rounds", label: "Max Rounds", icon: "bar-chart", on: (r) => r.maxRounds !== null, set: (on) => ({ maxRounds: on ? 5 : null }) },
  { key: "round-delay", label: "Round Delay", icon: "stopwatch", on: (r) => r.roundDelayMs > 0, set: (on) => ({ roundDelayMs: on ? 1200 : 0 }) },
  // D106 — the 2-seat neutral is asked for, never assumed. Ignored above two seats.
  { key: "neutral-holding", label: "Neutral Army (1v1)", icon: "person", on: (r) => r.neutralHolding, set: (on) => ({ neutralHolding: on }) },
];

const MODE_LABEL: Record<Rules["winCondition"], string> = {
  world: "World Domination",
  percentage: "Percentage Domination",
  capitals: "Capitals",
};

const PLAY_ROUTE = {
  solo: "/play/solo",
  "pass-and-play": "/play/pass-and-play",
  online: "/lobby",
} as const;

export default function RulesPage() {
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const mode = useSessionConfig((s) => s.mode);
  const rules = useSessionConfig((s) => s.rules);
  const seats = useSessionConfig((s) => s.seats);
  const source = useSessionConfig((s) => s.source);

  const hero = (
    <div className="flex flex-col items-center gap-1">
      <span
        data-testid="rules-player-count"
        className="flex items-center gap-2 rounded-[8px] px-3 py-1 font-head font-bold"
        style={{ background: "var(--chrome-700)", border: "2px solid var(--chrome-line)", color: "var(--text)" }}
      >
        <Icon name="person" size={20} />
        {seats.length}/{MAX_SEATS}
      </span>
      <span
        data-testid="rules-mode-plate"
        className="on-board-text px-4 py-1"
        style={{
          borderRadius: 8,
          fontSize: "clamp(18px, 2.6vw, 34px)",
          background: `linear-gradient(var(--danger), ${SETUP_TOKENS.modePlateBottom})`,
        }}
      >
        {MODE_LABEL[rules.winCondition]}
      </span>
      <span
        data-testid="rules-custom-chip"
        className="rounded-[6px] px-3 font-head font-bold"
        style={{ background: "var(--chrome-900)", color: "var(--danger)", fontSize: "clamp(12px,1.4vw,18px)" }}
      >
        CUSTOM
      </span>
    </div>
  );

  return (
    <main
      data-testid="rules-screen"
      className="relative flex min-h-dvh flex-1 flex-col items-center gap-5 px-4 py-6"
      style={{ background: "radial-gradient(circle at 50% 36%, var(--chrome-900) 0%, var(--ocean-deep) 100%)" }}
    >
      <h1 className="on-board-text text-center" style={{ fontSize: "clamp(26px, 5vw, 48px)" }}>
        Modes and Modifiers
      </h1>

      <div className="flex w-full max-w-[1200px] flex-col items-center gap-8 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex w-full max-w-[420px] flex-col items-center gap-14">
          {source?.kind === "slug" ? (
            <MapTile slug={source.slug} testId="rules-hero-map" footer={hero} />
          ) : (
            <div
              data-testid="rules-hero-random"
              className="flex w-full flex-col items-center justify-center gap-2"
              style={{ aspectRatio: "8 / 7", color: "var(--text)" }}
            >
              <span className="on-board-text" style={{ fontSize: "clamp(18px, 2.6vw, 40px)" }}>
                {source ? "Random map" : "No map chosen"}
              </span>
              <Icon name="dice-cup" size={72} />
              {hero}
            </div>
          )}

          <RulesReadout rules={rules} />
        </div>

        <div
          data-testid="modifier-stack"
          className="flex flex-wrap justify-center gap-3 lg:w-[200px] lg:flex-col lg:items-center"
        >
          {MODIFIERS.map((modifier) => (
            <ModifierToggle
              key={modifier.key}
              modifierKey={modifier.key}
              label={modifier.label}
              icon={modifier.icon}
              on={modifier.on(rules)}
              onToggle={(next) => sessionConfigStore.getState().setRules(modifier.set(next))}
            />
          ))}
        </div>
      </div>

      <footer className="flex w-full flex-wrap items-center justify-center gap-5 pb-2 pt-4">
        <button
          type="button"
          data-testid="rules-modifiers"
          onClick={() => setPanelOpen(true)}
          className="rounded-[var(--r-pill)] px-6 font-head font-bold outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          style={{
            minHeight: 48,
            background: "var(--chrome-700)",
            border: "2px solid var(--chrome-line)",
            color: "var(--text)",
            fontSize: "clamp(16px, 2.2vw, 24px)",
          }}
        >
          Modifiers
        </button>

        <Pill
          label="BATTLE"
          testId="rules-battle"
          disabled={source === null || creating}
          onClick={() => {
            sessionConfigStore.getState().setReady(true);
            if (mode !== "online") {
              router.push(PLAY_ROUTE[mode]);
              return;
            }
            // D115 — online, BATTLE is what creates the lobby: the room opens with this map and
            // these modifiers, and the host is in it.
            setCreating(true);
            setCreateError(null);
            const name = createIdentityAdapter().readCached()?.displayName ?? "A";
            void createLobby(sessionConfigStore.getState(), `${name}'s game`).then((result) => {
              if ("code" in result) {
                router.push(`/lobby/${result.code}`);
                return;
              }
              setCreating(false);
              setCreateError(result.error);
            });
          }}
        />
        {createError !== null ? (
          <p data-testid="rules-create-error" className="text-sm" style={{ color: "var(--danger)" }}>
            {createError}
          </p>
        ) : null}
      </footer>

      {panelOpen ? (
        <ModifiersPanel
          seats={seats}
          rules={rules}
          online={mode === "online"}
          onClose={() => setPanelOpen(false)}
          onSeatChange={(index, patch) => sessionConfigStore.getState().setSeat(index, patch)}
          onSeatCount={(count) => sessionConfigStore.getState().setSeatCount(count)}
          onRulesChange={(patch) => sessionConfigStore.getState().setRules(patch)}
        />
      ) : null}
    </main>
  );
}
