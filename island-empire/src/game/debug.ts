import type { Action, BuyItem, GameState, TileCoord } from "@/engine/types";
import { engine } from "./engineApi";

import type { Session } from "./session";
import type { SessionConfig } from "./sessionConfig";

/**
 * `window.__islandDebug` (SPEC §11): how an e2e test reads game truth
 * without pixel-sampling the canvas. Exposed outside production builds, or
 * in any build when `NEXT_PUBLIC_ISLAND_DEBUG=1` or `?debug=1` is present —
 * the e2e suite runs `next build`, so its helpers pass the query param.
 */
export interface IslandDebug {
  state(): GameState;
  applyForTest(action: Action): void;
  skipAnimations(): void;
  config(): SessionConfig;
  /** UI-observable slice, for assertions about selection / modals. */
  ui(): { selected: { x: number; y: number } | null; aiPlaying: boolean; gameOver: boolean; handOff: boolean; banner: string | null };
  camera(): { x: number; y: number; tilePx: number };
  /** Engine queries, so a spec can pick legal moves without re-deriving rules. */
  moveZone(at: TileCoord): TileCoord[];
  buildZone(item: BuyItem): TileCoord[];
}

export function debugEnabled(search: string): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.NEXT_PUBLIC_ISLAND_DEBUG === "1") return true;
  return /[?&]debug=1(&|$)/.test(search);
}

export function installDebug(session: Session): () => void {
  const handle: IslandDebug = {
    state: () => session.state,
    applyForTest: (action) => session.applyForTest(action),
    skipAnimations: () => session.skipAnimations(),
    config: () => session.config,
    ui: () => {
      const s = session.store.getState();
      return { selected: s.selected, aiPlaying: s.aiPlaying, gameOver: !!s.gameOver, handOff: !!s.handOff, banner: s.banner };
    },
    camera: () => ({ x: session.camera.x, y: session.camera.y, tilePx: session.camera.tilePx }),
    moveZone: (at) => engine.legalMoveZone(session.state, at),
    buildZone: (item) => engine.legalBuildZone(session.state, item),
  };
  (window as unknown as { __islandDebug?: IslandDebug }).__islandDebug = handle;
  return () => {
    delete (window as unknown as { __islandDebug?: IslandDebug }).__islandDebug;
  };
}
