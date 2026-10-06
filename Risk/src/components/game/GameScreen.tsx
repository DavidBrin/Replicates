"use client";

/**
 * The one game screen (SPEC §7, F26).
 *
 * S4 builds **every** part of it, including the three pieces only an online
 * game uses — the turn-timer bar, the roster presence dots and the chat
 * drawer — so S5's `/play/online/[gameId]` is a composition and nothing else:
 * it creates the `SyncPort`, holds the poll response, and passes `presence`,
 * `turnDeadline`, `chat` and `onChat` down.
 *
 * No `GameState` reaches React state: the HUD subscribes to the session's UI
 * slice and reads `session.state` during render; the board repaints itself.
 */
import { useCallback, useMemo } from "react";

import type { Session } from "@/game/session";
import { useUi } from "@/game/useSession";
import type { ChatLine, ChatSend, PresenceRow, SyncPort } from "@/ports/sync";
import { continentVar } from "@/render/palette";

import { ChatDrawer } from "@/components/chat/ChatDrawer";
import { HandOffOverlay } from "@/components/setup/HandOffOverlay";
import { CountSlider } from "@/components/ui/CountSlider";

import { ActionBar, phaseLabelFor, primaryLabelFor } from "./ActionBar";
import { BoardCanvas } from "./BoardCanvas";
import { BottomLeftStack, OverlayToolbar, TitlePill, UtilityButtons } from "./HudChrome";
import { Roster } from "./Roster";
import { useGameScreenModel } from "./useGameScreenModel";
import { GameDialogs } from "./GameDialogs";

export interface GameScreenProps {
  readonly session: Session;
  // ---- online only; every one of these is absent or null offline ----
  readonly sync?: SyncPort | null;
  readonly presence?: readonly PresenceRow[];
  readonly turnDeadline?: string | null;        // ISO 8601, straight from POLL 3
  readonly chat?: readonly ChatLine[];
  readonly onChat?: (line: ChatSend) => void;
}

export default function GameScreen(props: GameScreenProps) {
  const { session } = props;
  const ui = useUi(session, (s) => s);
  const model = useGameScreenModel(session, props.presence);

  const primary = useMemo(() => primaryLabelFor({
    phase: model.state.phase,
    yourTurn: model.yourTurn,
    botPlaying: ui.botPlaying,
    mustTrade: model.mustTrade,
    tradeValue: model.tradeValue,
    canTrade: model.sets.length > 0,
    troopsToPlace: model.state.troopsToPlace,
    pendingMoveIn: model.state.pendingMoveIn !== null,
  }), [model, ui.botPlaying]);

  const onPrimary = useCallback(() => {
    if (model.state.pendingMoveIn) {
      session.setModal("count");
      return;
    }
    if (model.mustTrade) {
      session.setModal("cards");
      return;
    }
    if (model.state.phase === "fortify") {
      if (ui.settings.endPhaseConfirmation) session.setModal("endTurn");
      else session.endTurn();
      return;
    }
    session.endPhase();
  }, [model, session, ui.settings.endPhaseConfirmation]);

  const legend = useMemo(() => (ui.overlayMode === "continents"
    ? session.map.continents.map((c) => ({
      name: c.name,
      bonus: c.bonus,
      held: c.territories.filter((t) => model.state.territories[t]?.owner === ui.viewerSeat).length,
      total: c.territories.length,
      at: centroidOf(session, c.territories),
      colour: continentVar(c.index),
    }))
    : []), [ui.overlayMode, ui.viewerSeat, session, model.state]);

  const onSend = useCallback((send: ChatSend) => {
    if (props.onChat) {
      props.onChat(send);
      return;
    }
    if ("lineId" in send) session.say(send.lineId);
    else session.sayEmoji(send.emoji);
  }, [props, session]);

  const me = model.rows.find((r) => r.seat === ui.viewerSeat) ?? model.rows[0];

  return (
    <main
      data-testid="game-screen"
      data-phase={model.state.phase}
      data-acting-seat={ui.actingSeat}
      data-viewer-seat={ui.viewerSeat}
      className="relative h-dvh w-full overflow-hidden"
      style={{ background: "var(--ocean-deep)" }}
    >
      <BoardCanvas session={session} hidden={ui.hidden} />

      {!ui.hidden ? (
        <>
          <UtilityButtons
            onSettings={() => session.setModal("settings")}
            onHelp={() => session.setModal("help")}
            onDiceSettings={() => session.setModal("dice")}
            syncStatus={props.sync ? ui.syncStatus : null}
          />
          <TitlePill text={ui.bannerText ?? ""} />
          <Roster rows={model.rows} balloons={model.balloons} />
          <OverlayToolbar mode={ui.overlayMode} onMode={(mode) => session.setOverlay(mode)} />
          <BottomLeftStack
            cardCount={model.myCards.length}
            tradeAvailable={model.sets.length > 0}
            unreadChat={0}
            onStats={() => session.setOverlay(ui.overlayMode === "players" ? "none" : "players")}
            onCards={() => session.setModal("cards")}
            onChat={() => session.store.setState({ chatOpen: !ui.chatOpen })}
          />
          <ActionBar
            phase={model.state.phase}
            phaseLabel={phaseLabelFor(model.state.phase, model.state.rules.capitals)}
            prompt={session.prompt()}
            seatName={model.acting?.name ?? ""}
            colour={model.acting?.colour ?? "red"}
            you={ui.actingSeat === ui.viewerSeat}
            bot={model.acting?.kind === "bot"}
            primaryLabel={primary.label}
            primaryDisabled={primary.disabled}
            onPrimary={onPrimary}
            onDice={() => session.setModal("dice")}
            turnDeadline={props.turnDeadline ?? ui.turnDeadline}
            turnSeconds={model.state.rules.turnSeconds}
          />
        </>
      ) : null}

      {ui.countRequest && ui.modal === "count" ? (
        <CountSlider
          title={countTitle(ui.countRequest.kind)}
          min={ui.countRequest.min}
          max={ui.countRequest.max}
          value={model.countValue}
          onChange={model.setCountValue}
          onConfirm={() => session.confirmCount(model.countValue)}
          onCancel={() => session.cancelCount()}
          showMoveAll={ui.countRequest.kind === "moveIn"}
        />
      ) : null}

      <GameDialogs session={session} model={model} legend={legend} />

      <ChatDrawer
        open={ui.chatOpen}
        me={{ name: me?.name ?? "You", colour: me?.colour ?? "red" }}
        lines={props.chat ?? ui.chat}
        allied={(model.state.seats[ui.viewerSeat]?.allies.length ?? 0) > 0}
        onSend={onSend}
        onClose={() => session.store.setState({ chatOpen: false })}
      />

      {ui.handOff ? (
        <HandOffOverlay
          playerName={model.state.seats[ui.handOff.seat]?.name ?? `Seat ${ui.handOff.seat}`}
          colour={model.state.seats[ui.handOff.seat]?.colour ?? "red"}
          onContinue={() => session.continueHandOff()}
        />
      ) : null}
    </main>
  );
}

function countTitle(kind: "draft" | "moveIn" | "fortify"): string {
  if (kind === "draft") return "Deploy Troops";
  if (kind === "moveIn") return "Move Troops";
  return "Fortify Troops";
}

/** The mean of a continent's token anchors — good enough for the legend. */
function centroidOf(session: Session, territories: readonly number[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const t of territories) {
    const anchor = session.map.territories[t]?.token;
    if (!anchor) continue;
    x += anchor[0];
    y += anchor[1];
    n += 1;
  }
  return n === 0 ? { x: 0, y: 0 } : { x: x / n, y: y / n };
}
