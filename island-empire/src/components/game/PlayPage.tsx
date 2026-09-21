"use client";

import { useEffect, useMemo, useState } from "react";

import { localProgress } from "@/adapters/localStorage/progress";
import { localSettings } from "@/adapters/localStorage/settings";
import { loadSaved, sourceKey, storeSaved } from "@/game/autosave";
import { debugEnabled, installDebug } from "@/game/debug";
import { engine } from "@/game/engineApi";
import { loadMapForSource } from "@/game/mapLoader";
import { createSession, type Session } from "@/game/session";
import type { SessionConfig } from "@/game/sessionConfig";
import { OUTLINE, UI } from "@/render/palette";

import { GameScreen } from "./GameScreen";
import { HUD_HEIGHT, pixelText } from "./styles";

export interface PlayPageProps {
  config: SessionConfig;
  /** Title once the map is known (defaults to the map name). */
  title?: string | ((mapName: string) => string);
  onQuit: () => void;
  onNextLevel?: (() => void) | null;
}

/**
 * Shared by the three `/play/**` routes: load the map for the source,
 * resume the autosave (unless `?fresh=1`), create the session, expose
 * `window.__islandDebug` when allowed, and mount the screen.
 */
export function PlayPage({ config, title, onQuit, onNextLevel }: PlayPageProps) {
  const [nonce, setNonce] = useState(0);
  const key = useMemo(() => sourceKey(config), [config]);
  // Results are tagged with the generation that produced them, so a stale
  // session from a previous config reads as "loading" without a synchronous
  // reset inside the effect.
  const gen = `${key}#${nonce}`;
  const [result, setResult] = useState<{ gen: string; session: Session | null; error: string | null }>({ gen: "", session: null, error: null });
  const session = result.gen === gen ? result.session : null;
  const error = result.gen === gen ? result.error : null;

  useEffect(() => {
    let alive = true;
    let created: Session | null = null;
    let uninstall: (() => void) | null = null;
    (async () => {
      try {
        const { map } = await loadMapForSource(config.source);
        if (!alive) return;
        const search = window.location.search;
        const fresh = /[?&]fresh=1/.test(search) || nonce > 0;
        const saved = fresh ? null : loadSaved(key);
        if (fresh) storeSaved(key, null);
        const s = createSession({
          map,
          config,
          engine,
          settings: localSettings,
          progress: localProgress,
          resume: saved,
          save: (v) => storeSaved(key, v),
          viewport: { w: window.innerWidth, h: window.innerHeight - HUD_HEIGHT },
        });
        created = s;
        if (debugEnabled(search)) uninstall = installDebug(s);
        s.start();
        setResult({ gen, session: s, error: null });
      } catch (e) {
        if (alive) setResult({ gen, session: null, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
      created?.destroy();
      uninstall?.();
    };
  }, [config, key, nonce, gen]);

  const retry = () => {
    storeSaved(key, null);
    setNonce((n) => n + 1);
  };

  if (error) {
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center" style={{ background: UI.sky }} role="alert">
        <p className="text-2xl" style={pixelText}>
          The game could not start
        </p>
        <p className="text-sm" style={pixelText}>
          {error}
        </p>
        <button type="button" onClick={onQuit} className="px-6 py-3 text-lg" style={{ background: UI.buyGreen, border: `3px solid ${OUTLINE}`, borderRadius: 6, ...pixelText }}>
          Back to menu
        </button>
      </main>
    );
  }
  if (!session) {
    return (
      <main className="fixed inset-0 flex items-center justify-center" style={{ background: UI.sky }} data-testid="play-loading">
        <p className="text-2xl" style={pixelText}>
          Loading...
        </p>
      </main>
    );
  }
  const resolvedTitle = typeof title === "function" ? title(session.map.name) : (title ?? session.map.name);
  return <GameScreen session={session} title={resolvedTitle} onQuit={onQuit} onRetry={retry} onNextLevel={onNextLevel ?? null} />;
}
