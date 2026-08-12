"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
import { SkewButton, SkewPanel } from "@/components/ui/SkewPanel";
import { Stepper } from "@/components/ui/Stepper";
import { Segmented, Toggle } from "@/components/ui/Toggle";
import {
  DEFAULT_TIME_FRAMES,
  MAX_STOCKS,
  MAX_TIME_FRAMES,
  MIN_STOCKS,
  MIN_TIME_FRAMES,
  TIME_STEP_FRAMES,
  formatTime,
  useMatchConfig,
} from "@/lib/matchConfig";

/**
 * The rules screen.
 *
 * Ultimate shows both the stock count and the time limit whichever mode is
 * selected — a timed match still ends early if everyone runs out of stocks,
 * and the count is not meaningless just because it is not the win condition.
 * The inactive row is dimmed rather than removed, so switching mode does not
 * make the panel jump.
 */
export function RulesPanel() {
  const router = useRouter();
  const rules = useMatchConfig((s) => s.rules);
  const players = useMatchConfig((s) => s.players);
  const setMode = useMatchConfig((s) => s.setMode);
  const setStocks = useMatchConfig((s) => s.setStocks);
  const setTimeLimit = useMatchConfig((s) => s.setTimeLimit);
  const setSmashBall = useMatchConfig((s) => s.setSmashBall);

  return (
    <main className="flex min-h-dvh flex-col bg-[#101215]">
      <ScreenBanner onBack={() => router.push("/menu")} backLabel="Back to the main menu" tab={<ModeTab label="Rules" />}>
        <SkewPanel
          className="hidden border-[3px] border-panel-ink bg-panel-ink sm:block"
          innerClassName="px-4 py-1 text-xs font-bold tracking-wide text-white/75"
        >
          Step 1 of 3
        </SkewPanel>
      </ScreenBanner>

      <div className="mx-auto w-full max-w-4xl flex-1 px-5 pb-10 sm:px-8">
        <div className="flex flex-col gap-3">
          <Row label="Style" hint="Stock ends when a player runs out of lives. Time ends on the clock.">
            <Segmented
              label="Match style"
              value={rules.mode}
              onChange={setMode}
              options={[
                { value: "stock", label: "Stock" },
                { value: "time", label: "Time" },
              ]}
            />
          </Row>

          <Row label="Stock" hint="Lives per fighter." dim={rules.mode !== "stock"}>
            <Stepper
              label="Stock count"
              value={rules.stocks}
              min={MIN_STOCKS}
              max={MAX_STOCKS}
              onChange={setStocks}
            />
          </Row>

          <Row label="Time Limit" hint="Half-minute steps, as on the real dial." dim={rules.mode !== "time"}>
            <Stepper
              label="Time limit"
              value={rules.timeLimit}
              min={MIN_TIME_FRAMES}
              max={MAX_TIME_FRAMES}
              step={TIME_STEP_FRAMES}
              format={formatTime}
              onChange={setTimeLimit}
            />
          </Row>

          <Row label="Smash Ball" hint="The only item in this build. Breaking it arms a Final Smash.">
            <Toggle label="Smash Ball" checked={rules.smashBall} onChange={setSmashBall} />
          </Row>

          {/* Not a setting. Ultimate applies the 1v1 bonus whenever exactly two
              fighters are on the stage, so the row reports the consequence of
              the player count rather than offering a switch that does not
              exist in the game being reproduced. */}
          <Row
            label="1v1 Damage"
            hint="Applied automatically when the match has exactly two fighters — SPEC §4."
          >
            <SkewPanel
              className="border-[3px] border-panel-ink"
              style={{ backgroundColor: rules.oneOnOne ? "var(--smash-yellow)" : "#2a2d33" }}
              innerClassName="px-6 py-2 font-display text-2xl leading-none"
            >
              <span className={rules.oneOnOne ? "text-panel-ink" : "text-white/40"}>
                {rules.oneOnOne ? "1.2×" : "1.0×"}
              </span>
            </SkewPanel>
          </Row>
        </div>

        <p className="mt-4 px-2 text-xs text-white/45">
          {players.length} fighters configured. The bonus follows the player count, which is set on the
          character select screen.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <SkewButton
            onClick={() => {
              setMode("stock");
              setStocks(3);
              setTimeLimit(DEFAULT_TIME_FRAMES);
              setSmashBall(true);
            }}
            className="border-[3px] border-panel-ink bg-[#2a2d33] px-6 py-3 text-white/80 transition-colors hover:bg-[#383c44]"
            innerClassName="font-display text-base tracking-[0.16em] uppercase"
          >
            Defaults
          </SkewButton>

          <SkewButton
            onClick={() => router.push("/stage")}
            className="border-[4px] border-panel-ink bg-smash-yellow px-10 py-3 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-1"
            innerClassName="font-display text-xl tracking-[0.18em] uppercase"
          >
            Choose Stage →
          </SkewButton>
        </div>
      </div>
    </main>
  );
}

function Row({
  label,
  hint,
  dim,
  children,
}: {
  label: string;
  hint: string;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <SkewPanel
      className="border-[3px] border-panel-ink bg-[#181b20] transition-opacity"
      style={{ opacity: dim ? 0.45 : 1 }}
      innerClassName="flex flex-wrap items-center gap-4 px-6 py-4"
    >
      <div className="min-w-[12rem] flex-1">
        <div className="font-display text-xl tracking-[0.12em] text-white uppercase">{label}</div>
        <div className="text-xs text-white/50">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </SkewPanel>
  );
}
