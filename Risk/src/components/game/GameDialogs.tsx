"use client";

/**
 * Every modal and overlay the game screen can show, wired to one session
 * (SPEC §7.2). The dialogs themselves are presentational and import no
 * session; this file is the only place the two meet.
 */
import { useCallback, useState } from "react";

import type { Card, TerritoryId } from "@/engine/types";
import type { Session } from "@/game/session";
import { useUi } from "@/game/useSession";
import { playEngine } from "@/game/pending";

import { BlitzView } from "./dialogs/BlitzView";
import { CardTradePanel } from "./dialogs/CardTradePanel";
import { ContinentLegend, type ContinentLegendEntry } from "./dialogs/ContinentLegend";
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
  readonly legend: readonly ContinentLegendEntry[];
}

const HELP_TEXT = "Hold a whole continent at the start of your turn to collect its bonus.";

export function GameDialogs({ session, model, legend }: GameDialogsProps) {
  const ui = useUi(session, (s) => s);
  const engine = playEngine();
  const [selectedCards, setSelectedCards] = useState<readonly string[]>([]);

  const toggleCard = useCallback((id: string) => {
    setSelectedCards((prev) => (prev.includes(id)
      ? prev.filter((x) => x !== id)
      : [...prev, id].slice(-3)));
  }, []);

  const state = model.state;
  const attack = ui.pendingAttack;

  const onTrade = useCallback(() => {
    if (selectedCards.length !== 3) return;
    const trio = [selectedCards[0], selectedCards[1], selectedCards[2]] as [string, string, string];
    const bonus = bonusTerritoryFor(model.myCards, trio, (t) => state.territories[t]?.owner === ui.viewerSeat);
    session.tradeCards(trio, bonus);
    setSelectedCards([]);
  }, [selectedCards, model.myCards, session, state.territories, ui.viewerSeat]);

  const tradeValue = selectedCards.length === 3
    ? engine.cardTradeValue(
      selectedCards.map((id) => model.myCards.find((c) => c.id === id)).filter((c): c is Card => !!c),
      state.setsTradedTotal, state.rules.cardBonus,
    )
    : model.tradeValue;

  return (
    <>
      {legend.length > 0 ? <ContinentLegend entries={legend} /> : null}

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
              ? { from: attack.from, to: attack.to, mode: "blitz", ...(ui.attackLimit !== null ? { stopUntil: ui.attackLimit } : {}) }
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
          onDone={() => session.store.setState({ dice: null })}
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
          bonusTerritoryName={null}
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
          onLeave={() => session.setModal(null)}
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

/** The first traded card naming a territory the trader occupies (R23). */
function bonusTerritoryFor(
  hand: readonly Card[], trio: readonly string[], owned: (t: TerritoryId) => boolean,
): TerritoryId | null {
  for (const id of trio) {
    const card = hand.find((c) => c.id === id);
    if (card?.territory != null && owned(card.territory)) return card.territory;
  }
  return null;
}

function countTerritories(
  territories: readonly { readonly owner: number }[], seat: number,
): number {
  return territories.filter((t) => t.owner === seat).length;
}

export default GameDialogs;
