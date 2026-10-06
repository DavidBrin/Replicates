"use client";

/**
 * The three pieces of HUD chrome that are not the roster or the action bar
 * (SPEC §7.1): the top-left utility buttons, the title pill, the bottom-left
 * stack and the Continent Overlay toolbar.
 */
import clsx from "clsx";

import type { SyncStatus } from "@/ports/sync";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";

export interface UtilityButtonsProps {
  readonly onSettings: () => void;
  readonly onHelp: () => void;
  readonly onDiceSettings: () => void;
  /** Online adds a connection glyph after the three buttons. */
  readonly syncStatus?: SyncStatus | null;
}

/**
 * Three circular **outline-only** buttons — 3 px white stroke, no fill — at a
 * 78 px pitch, with the online connection glyph after them.
 */
export function UtilityButtons({ onSettings, onHelp, onDiceSettings, syncStatus }: UtilityButtonsProps) {
  return (
    <div
      data-testid="utility-buttons"
      className="pointer-events-auto absolute left-0 top-0 flex items-center gap-[34px] p-[30px]"
      style={{ zIndex: "var(--z-hud)" }}
    >
      <IconButton chassis="outline" icon="gear" size={44} label="Settings" onClick={onSettings}
        testId="utility-settings" />
      <IconButton chassis="outline" icon="question" size={44} label="Help" onClick={onHelp}
        testId="utility-help" />
      <IconButton chassis="outline" icon="die" size={44} label="Dice settings" onClick={onDiceSettings}
        testId="utility-dice" />
      {syncStatus && syncStatus !== "offline" ? (
        <span
          data-testid="sync-status"
          data-status={syncStatus}
          title={syncStatus}
          className="opacity-80"
          style={{ color: syncStatus === "desynced" ? "var(--danger)" : "var(--cyan)" }}
        >
          <Icon name="globe" size={28} />
        </span>
      ) : null}
    </div>
  );
}

export interface TitlePillProps {
  readonly text: string;
}

/** Centred, auto width, `rgba(14,42,51,.72)`, radius 10, bold white 30 px. */
export function TitlePill({ text }: TitlePillProps) {
  if (!text) return null;
  return (
    <div
      data-testid="title-pill"
      className="pointer-events-none absolute left-1/2 top-[20px] -translate-x-1/2"
      style={{ zIndex: "var(--z-hud)" }}
    >
      <span
        className="on-board-text block"
        style={{
          background: "rgba(14,42,51,.72)", borderRadius: 10, padding: "10px 26px", fontSize: 30,
        }}
      >
        {text}
      </span>
    </div>
  );
}

export interface BottomLeftStackProps {
  readonly cardCount: number;
  readonly tradeAvailable: boolean;
  readonly unreadChat: number;
  readonly onStats: () => void;
  readonly onCards: () => void;
  readonly onChat: () => void;
}

/**
 * Stats tray, the −8° cards chip with its red badge, and the emote button.
 *
 * **At phone width the stack goes horizontal and lifts clear of the action
 * bar** (SPEC §8.9: "< 820 px … the icon stack goes horizontal"; portrait:
 * "the icon stack becomes one row immediately above it"). It has to: the
 * bar's own `pointer-events-auto` column is taller than the band it is
 * anchored in, so at 412 px it reached up over this stack and the pip row
 * intercepted every tap aimed at Chat. `--action-bar-h` is the bar's height,
 * so the clearance is exact rather than guessed — and both resolve their
 * percentage against the same containing block, the game screen's `main`.
 */
export function BottomLeftStack(props: BottomLeftStackProps) {
  return (
    <div
      data-testid="bottom-left-stack"
      className={clsx(
        "pointer-events-auto absolute bottom-[4%] left-[2%] flex flex-col items-start gap-3",
        "max-[480px]:bottom-[calc(var(--action-bar-h)+8px)] max-[480px]:flex-row",
        "max-[480px]:items-end max-[480px]:gap-2",
      )}
      style={{ zIndex: "var(--z-hud)" }}
    >
      <IconButton chassis="tray" icon="bar-chart" size={90} label="Stats" onClick={props.onStats}
        testId="stats-button" />

      <div className="flex items-end gap-3 max-[480px]:gap-2">
        <button
          type="button"
          data-testid="cards-chip"
          aria-label={`Cards (${props.cardCount} held)`}
          onClick={props.onCards}
          className="relative flex items-center justify-center font-black"
          style={{
            width: 95, height: 112, transform: "rotate(-8deg)",
            background: "var(--paper)", color: "var(--text-on-paper)",
            borderRadius: 10, boxShadow: "var(--sh-card)", fontSize: 40,
          }}
        >
          {props.cardCount}
          {props.tradeAvailable ? (
            <span
              data-testid="cards-badge"
              className="absolute -right-2 -top-2 rounded-full"
              style={{ width: 20, height: 20, background: "var(--danger)" }}
            />
          ) : null}
        </button>

        <div className="relative">
          <IconButton chassis="tray" icon="speaking-head" size={90} label="Chat" onClick={props.onChat}
            testId="emote-button" />
          {props.unreadChat > 0 ? (
            <span
              data-testid="chat-badge"
              className="absolute -right-1 -top-1 flex items-center justify-center rounded-full text-xs font-bold"
              style={{ width: 22, height: 22, background: "var(--danger)", color: "#fff" }}
            >
              {props.unreadChat}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type OverlayMode = "none" | "troops" | "continents" | "players";

export interface OverlayToolbarProps {
  readonly mode: OverlayMode;
  readonly onMode: (mode: OverlayMode) => void;
}

const OVERLAY_TOGGLES: readonly { readonly mode: OverlayMode; readonly icon: "soldier" | "globe" | "person";
  readonly label: string }[] = [
    { mode: "troops", icon: "soldier", label: "Troop view" },
    { mode: "continents", icon: "globe", label: "Continent overlay" },
    { mode: "players", icon: "person", label: "Player view" },
  ];

/**
 * A vertical dark-teal capsule with three 44 px toggles, the active one gold,
 * and a detached grey tray below holding the red close ✗. Shown in overlay
 * mode only (§7.1).
 */
export function OverlayToolbar({ mode, onMode }: OverlayToolbarProps) {
  if (mode === "none") return null;
  return (
    <div
      data-testid="overlay-toolbar"
      className="pointer-events-auto absolute left-[3%] top-1/2 flex -translate-y-1/2 flex-col items-center gap-4"
      style={{ zIndex: "var(--z-hud)" }}
    >
      <div
        className="flex flex-col items-center gap-5 py-5"
        style={{ width: 100, borderRadius: 50, background: "rgba(12,42,52,.92)" }}
      >
        {OVERLAY_TOGGLES.map((toggle) => (
          <button
            key={toggle.mode}
            type="button"
            data-testid={`overlay-${toggle.mode}`}
            data-active={mode === toggle.mode ? "true" : "false"}
            aria-pressed={mode === toggle.mode}
            aria-label={toggle.label}
            onClick={() => onMode(toggle.mode)}
            className={clsx("flex items-center justify-center rounded-full")}
            style={{
              width: 44, height: 44,
              color: mode === toggle.mode ? "var(--gold)" : "var(--text-muted)",
            }}
          >
            <Icon name={toggle.icon} size={32} />
          </button>
        ))}
      </div>

      <div
        className="flex items-center justify-center"
        style={{ width: 90, height: 100, borderRadius: 18, background: "var(--tray)" }}
      >
        <IconButton chassis="circle" icon="cross" size={68} label="Close overlay" tone="danger"
          onClick={() => onMode("none")} testId="overlay-close" />
      </div>
    </div>
  );
}
