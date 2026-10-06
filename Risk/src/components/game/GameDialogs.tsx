"use client";

/**
 * Every modal and overlay the game screen can show, wired to one session
 * (SPEC §7.2). The dialogs themselves are presentational and import no
 * session; this file is the only place the two meet.
 */
import { useCallback, useMemo, useState } from "react";

import type { Card, TerritoryId } from "@/engine/types";
import { bonusTerritoryFor } from "@/game/cardChoice";
import type { Session } from "@/game/session";
import { useUi } from "@/game/useSession";
import { playEngine } from "@/game/pending";

import { BattleLogPanel } from "./dialogs/BattleLogPanel";
import { BlitzView } from "./dialogs/BlitzView";
import { CardTradePanel } from "./dialogs/CardTradePanel";
import { EndTurnConfirm } from "./dialogs/EndTurnConfirm";
import { GetReadyOverlay } from "./dialogs/GetReadyOverlay";
import { ManualDiceView } from "./dialogs/ManualDiceView";
import { ReceivedTroops } from "./dialogs/ReceivedTroops";
import { SettingsDialog } from "./dialogs/SettingsDialog";
import { TipCard } from "./dialogs/TipCard";
import { VictoryOverlay } from "./dialogs/VictoryOverlay";
import type { GameScreenModel } from "./useGameScreenModel";

export interface GameDialogsProps {
  readonly session: Session;
  readonly model: GameScreenModel;
  /** Where `Leave Game` and the end frames go. Defaults to the home page (D111). */
  readonly homeHref?: string;
}

const HELP_TEXT = "Hold a whole continent at the start of your turn to collect its bonus.";
const EMPTY_SELECTION: readonly string[] = [];

export function GameDialogs({ session, model, homeHref = "/" }: GameDialogsProps) {
  const ui = useUi(session, (s) => s);
  const engine = playEngine();
  /*
   * D110 — the panel opens with the best set already picked, so a trade is one tap. The player
   * can still re-pick; a re-open starts from the best set again. The selection is keyed on the
   * best set it was derived from and re-derived DURING RENDER when that key moves (React's
   * "adjust state when a prop changes" idiom), never in an effect: an effect would paint one
   * frame with the stale selection and then cascade a second render.
   */
  const bestSet = model.bestSet;
  const cardsOpen = ui.modal === "cards";
  const [selection, setSelection] = useState<{ key: typeof bestSet | undefined; cards: readonly string[] }>(
    { key: undefined, cards: [] },
  );
  if (cardsOpen && selection.key !== bestSet) {
    setSelection({ key: bestSet, cards: bestSet ? [...bestSet.set] : [] });
  } else if (!cardsOpen && selection.key !== undefined) {
    setSelection({ key: undefined, cards: [] });
  }
  const selectedCards = useMemo(
    () => (cardsOpen && selection.key === bestSet ? selection.cards : EMPTY_SELECTION),
    [cardsOpen, selection, bestSet],
  );
  const setSelectedCards = useCallback((next: readonly string[] | ((prev: readonly string[]) => readonly string[])) => {
    setSelection((prev) => ({ key: prev.key, cards: typeof next === "function" ? next(prev.cards) : next }));
  }, []);

  const leave = useCallback(() => {
    session.setModal(null);
    window.location.assign(homeHref);
  }, [session, homeHref]);

  const toggleCard = useCallback((id: string) => {
    setSelectedCards((prev) => (prev.includes(id)
      ? prev.filter((x) => x !== id)
      : [...prev, id].slice(-3)));
  }, [setSelectedCards]);

  const state = model.state;
  const attack = ui.pendingAttack;

  const onTrade = useCallback(() => {
    if (selectedCards.length !== 3) return;
    const trio = [selectedCards[0], selectedCards[1], selectedCards[2]] as [string, string, string];
    const bonus = bonusTerritoryFor(model.myCards, trio, (t) => state.territories[t]?.owner === ui.viewerSeat);
    session.tradeCards(trio, bonus);
    setSelectedCards([]);
  }, [selectedCards, model.myCards, session, state.territories, ui.viewerSeat, setSelectedCards]);

  const tradeValue = selectedCards.length === 3
    ? engine.cardTradeValue(
      selectedCards.map((id) => model.myCards.find((c) => c.id === id)).filter((c): c is Card => !!c),
      state.setsTradedTotal, state.rules.cardBonus,
    )
    : model.tradeValue;

  const selectedBonus = selectedCards.length === 3
    ? bonusTerritoryFor(model.myCards, selectedCards, (t) => state.territories[t]?.owner === ui.viewerSeat)
    : null;

  return (
    <>
      {ui.modal === "log" ? (
        <BattleLogPanel
          entries={ui.battleLog}
          seats={state.seats.map((s) => ({ seat: s.seat, name: s.name, colour: s.colour }))}
          territoryName={(t) => session.map.territories[t]?.name ?? `#${t}`}
          onClose={() => session.setModal(null)}
        />
      ) : null}

      {ui.modal === "dice" && attack ? (
        <BlitzView
          attacker={combatant(model, attack.from, ui.viewerSeat)}
          defender={combatant(model, attack.to, ui.viewerSeat)}
          winChance={ui.blitzWinChance ?? 0}
          ramp={ui.settings.winChanceRamp}
          dice={ui.attackDice}
          maxDice={engine.dicePlan(state, session.map, attack.from, attack.to).maxAttackDice}
          onDice={(next) => session.setAttackDice(next)}
          attackLimit={ui.attackLimit}
          onAttackLimit={(stopUntil) => session.setAttackLimit(stopUntil)}
          onBattle={() => session.submitAttack(
            ui.attackDice === "blitz"
              // R48 — `stopUntil` is at least 1. The slider's left stop is 0, which means
              // "no limiter", so it is OMITTED rather than sent as an illegal 0.
              ? {
                from: attack.from, to: attack.to, mode: "blitz",
                ...(ui.attackLimit !== null && ui.attackLimit > 0 ? { stopUntil: ui.attackLimit } : {}),
              }
              : { from: attack.from, to: attack.to, mode: "manual", attackerDice: ui.attackDice },
          )}
          onCancel={() => {
            session.setModal(null);
            session.store.setState({ pendingAttack: null });
          }}
        />
      ) : null}

      {ui.dice && attack ? (
        <ManualDiceView
          attacker={ui.dice.attacker}
          defender={ui.dice.defender}
          at={{
            x: session.map.territories[attack.to]?.token[0] ?? 0,
            y: session.map.territories[attack.to]?.token[1] ?? 0,
          }}
          // The anchor lives until the dice leave: `pendingAttack` is what positions this overlay.
          onDone={() => session.store.setState({ dice: null, pendingAttack: null })}
        />
      ) : null}

      {ui.modal === "cards" ? (
        <CardTradePanel
          cards={model.myCards}
          sets={model.sets}
          selected={selectedCards}
          onToggle={toggleCard}
          value={tradeValue}
          scheme={state.rules.cardBonus}
          bonusTerritoryName={selectedBonus === null ? null : (session.map.territories[selectedBonus]?.name ?? null)}
          forced={model.mustTrade}
          onTrade={onTrade}
          onClose={() => session.setModal(null)}
        />
      ) : null}

      {ui.modal === "endTurn" ? (
        <EndTurnConfirm
          onYes={() => {
            session.setModal(null);
            session.endTurn();
          }}
          onNo={() => session.setModal(null)}
        />
      ) : null}

      {ui.modal === "getReady" && model.acting ? (
        <GetReadyOverlay
          playerNumber={ui.actingSeat + 1}
          name={model.acting.name}
          colour={model.acting.colour}
          onDone={() => session.setModal(null)}
        />
      ) : null}

      {ui.award && !ui.modal ? (
        <ReceivedTroops
          variant="received"
          name={state.seats[ui.award.seat]?.name ?? ""}
          colour={state.seats[ui.award.seat]?.colour ?? "red"}
          you={ui.award.seat === ui.viewerSeat}
          total={ui.award.total}
          territories={countTerritories(state.territories, ui.award.seat)}
          // A bot's draft award is the bot's news. The viewer gets the turn
          // banner and keeps the board; only a human seat gets the popup.
          bannerOnly={state.seats[ui.award.seat]?.kind === "bot"}
          onDone={() => session.dismissAward()}
        />
      ) : null}

      {ui.modal === "settings" ? (
        <SettingsDialog
          settings={ui.settings}
          onChange={(patch) => session.updateSettings(patch)}
          onChangeName={() => session.setModal(null)}
          onResign={() => {
            session.setModal(null);
            session.resign();
          }}
          onLeave={leave}
          onClose={() => session.setModal(null)}
        />
      ) : null}

      {ui.modal === "help" ? (
        <TipCard text={HELP_TEXT} onDismiss={() => session.setModal(null)} />
      ) : null}

      {ui.gameOver ? (
        <VictoryOverlay
          name={state.seats[ui.gameOver.winner]?.name ?? ""}
          colour={state.seats[ui.gameOver.winner]?.colour ?? "red"}
          defeated={ui.gameOver.winner !== ui.viewerSeat}
          reason={ui.gameOver.reason}
          round={ui.gameOver.round}
        />
      ) : null}
    </>
  );
}

function combatant(model: GameScreenModel, at: TerritoryId, viewer: number) {
  const tile = model.state.territories[at];
  const seat = tile && tile.owner >= 0 ? model.state.seats[tile.owner] : undefined;
  return {
    name: seat?.name ?? "Neutral",
    colour: seat?.colour ?? ("white" as const),
    troops: tile?.troops ?? 0,
    you: seat?.seat === viewer,
    bot: seat?.kind === "bot",
  };
}

function countTerritories(
  territories: readonly { readonly owner: number }[], seat: number,
): number {
  return territories.filter((t) => t.owner === seat).length;
}

export default GameDialogs;
