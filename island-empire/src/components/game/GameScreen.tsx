"use client";

import { HandOffOverlay } from "@/components/setup/HandOffOverlay";
import type { Session } from "@/game/session";

import { BackButton } from "./BackButton";
import { DayBanner } from "./DayBanner";
import { EndModal } from "./EndModal";
import { GameCanvas } from "./GameCanvas";
import { HudBar } from "./HudBar";
import { InfoCard } from "./InfoCard";
import { SessionProvider, useGameState, useSession, useUi } from "./SessionContext";
import { SettingsModal } from "./SettingsModal";
import { SpeechBubble } from "./SpeechBubble";
import { StrengthChart } from "./StrengthChart";
import { HUD_HEIGHT } from "./styles";
import { TopBar } from "./TopBar";

export interface GameScreenProps {
  session: Session;
  /** "Level: N" or the map name. */
  title: string;
  onQuit: () => void;
  onRetry: () => void;
  onNextLevel?: (() => void) | null;
}

/** The in-game screen (SPEC §7): canvas board plus every HUD element. */
export function GameScreen(props: GameScreenProps) {
  return (
    <SessionProvider session={props.session}>
      <Screen {...props} />
    </SessionProvider>
  );
}

function Screen({ title, onQuit, onRetry, onNextLevel }: GameScreenProps) {
  const session = useSession();
  const state = useGameState();
  const handOff = useUi((s) => s.handOff);
  return (
    <main data-testid="game-screen" className="fixed inset-0 overflow-hidden" style={{ background: "#2898F0" }}>
      <GameCanvas bottomInset={HUD_HEIGHT} />
      <TopBar title={title} />
      <BackButton />
      <InfoCard />
      <SpeechBubble />
      <DayBanner />
      <HudBar />
      <SettingsModal onQuit={onQuit} />
      <StrengthChart />
      <EndModal onRetry={onRetry} onMenu={onQuit} onNextLevel={onNextLevel ?? null} />
      {handOff && (
        <HandOffOverlay
          playerName={session.config.seats[handOff.player]?.name ?? capitalise(state.players[handOff.player]?.colour ?? "blue")}
          colour={state.players[handOff.player]?.colour ?? "blue"}
          onContinue={() => session.continueHandOff()}
        />
      )}
    </main>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
