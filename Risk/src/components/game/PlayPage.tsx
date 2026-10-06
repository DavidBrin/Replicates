"use client";

/**
 * The offline play route's shell (SPEC §5.1): resolve the map, mint the seed,
 * build the session, and hand `GameScreen` the result.
 *
 * `/play/solo` and `/play/pass-and-play` are both this page — the only
 * difference is the seat configuration the setup flow left in the store, and
 * the hand-off overlay the session raises when two or more seats are human.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { GameConfig, MapDef } from "@/engine/types";
import { createIdentityAdapter } from "@/adapters/localStorage/identity";
import { createProgressAdapter } from "@/adapters/localStorage/progress";
import { createSettingsAdapter } from "@/adapters/localStorage/settings";
import { newId } from "@/adapters/localStorage/store";
import { autosaveFor } from "@/game/autosave";
import { playEngine, playMapDef, playOdds, playRandomMap } from "@/game/pending";
import { createSession, type Session } from "@/game/session";
import { toGameConfig, useSessionConfig, withIdentityName, type GameMode } from "@/game/sessionConfig";

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

  const source = store.source;
  const rules = store.rules;
  // The viewer's seat carries the name the identity sheet claimed, so the
  // roster, the `Get Ready` plate and the avatar initial all read it (§7).
  // `readCached` touches `localStorage`, so it is read in the effect's scope,
  // never during render — but memoising the adapter keeps it stable.
  const identity = useMemo(() => createIdentityAdapter(), []);
  const seats = store.seats;

  // The route and the store must agree: landing on `/play/solo` with a
  // pass-and-play configuration means the setup flow was abandoned halfway.
  const configured = useMemo(
    () => store.ready && source !== null && store.mode === mode,
    [store.ready, source, store.mode, mode],
  );

  useEffect(() => {
    if (!configured) {
      router.replace("/new");
      return;
    }
    if (!source) return;

    // No `built once` ref here: React Strict Mode mounts, cleans up and
    // mounts again, and a ref that survives the cleanup would let the second
    // mount skip the build while the first mount's build had already been
    // cancelled — the board would never arrive. The effect builds every time
    // and the cleanup destroys whatever it built.
    let cancelled = false;
    let session: Session | null = null;
    void (async () => {
      try {
        // A generated map's slug is minted from its seed, so `GameState`
        // never has to describe a generator (§4.14).
        const map = source.kind === "random"
          ? playRandomMap(source.options, source.seed)
          : await playMapDef(source.slug);
        if (cancelled) return;
        const named = withIdentityName(seats, identity.readCached()?.displayName);
        const config = toGameConfig({ ...store, seats: named, rules }, map.slug, newId());
        const { resume, save } = autosaveFor(config);
        session = createSession({
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
        if (cancelled) {
          session.destroy();
          return;
        }
        session.start();
        setReady({ session, map, config });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
      session?.destroy();
      setReady(null);
    };
    // The store is read as a snapshot at build time, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

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
