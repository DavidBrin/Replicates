"use client";

/**
 * The offline play route's shell (SPEC §5.1): resolve the map, mint the seed,
 * build the session, and hand `GameScreen` the result.
 *
 * `/play/solo` and `/play/pass-and-play` are both this page — the only
 * difference is the seat configuration the setup flow left in the store, and
 * the hand-off overlay the session raises when two or more seats are human.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { GameConfig, MapDef } from "@/engine/types";
import { createProgressAdapter } from "@/adapters/localStorage/progress";
import { createSettingsAdapter } from "@/adapters/localStorage/settings";
import { newId } from "@/adapters/localStorage/store";
import { autosaveFor } from "@/game/autosave";
import { playEngine, playMapDef, playOdds } from "@/game/pending";
import { createSession, type Session } from "@/game/session";
import { toGameConfig, useSessionConfig, type GameMode } from "@/game/sessionConfig";

import GameScreen from "./GameScreen";

export interface PlayPageProps {
  readonly mode: Extract<GameMode, "solo" | "pass-and-play">;
}

interface Ready {
  readonly session: Session;
  readonly map: MapDef;
  readonly config: GameConfig;
}

export function PlayPage({ mode }: PlayPageProps) {
  const router = useRouter();
  const store = useSessionConfig((s) => s);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const built = useRef(false);

  const source = store.source;
  const seats = store.seats;
  const rules = store.rules;

  const configured = useMemo(() => store.ready && source !== null, [store.ready, source]);

  useEffect(() => {
    if (!configured) {
      router.replace("/new");
      return;
    }
    if (built.current || !source) return;
    built.current = true;

    let cancelled = false;
    void (async () => {
      try {
        if (source.kind === "random") {
          throw new Error("S3 pending: the random-map generator has not landed yet");
        }
        const map = await playMapDef(source.slug);
        if (cancelled) return;
        const config = toGameConfig({ ...store, seats, rules }, map.slug, newId());
        const { resume, save } = autosaveFor(config);
        const session = createSession({
          map,
          // A resumed game keeps the seed it was dealt from (D5).
          config: resume ? resume.config : config,
          engine: playEngine(),
          odds: playOdds(rules.diceMode),
          settings: createSettingsAdapter(),
          progress: createProgressAdapter(),
          resume,
          save,
        });
        session.start();
        setReady({ session, map, config });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
    };
    // The session is built exactly once per mount; the store is a snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  useEffect(() => () => ready?.session.destroy(), [ready]);

  if (error) {
    return (
      <main
        data-testid="play-error"
        className="flex h-dvh flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <p className="font-head text-2xl font-bold">This game could not be started.</p>
        <p style={{ color: "var(--text-muted)" }}>{error}</p>
        <button
          type="button"
          className="rounded-full px-6 py-3 font-semibold"
          style={{ background: "var(--chrome-700)", color: "var(--text)" }}
          onClick={() => router.push("/new")}
        >
          Back to setup
        </button>
      </main>
    );
  }

  if (!ready) {
    return (
      <main data-testid="play-loading" className="flex h-dvh items-center justify-center">
        <p className="font-head text-xl" style={{ color: "var(--text-muted)" }}>Preparing the board…</p>
      </main>
    );
  }

  return <GameScreen session={ready.session} />;
}

export default PlayPage;
