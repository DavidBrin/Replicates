"use client";

/**
 * The 3D world's code, loaded after the page mounts (Plan 4). `world3d.ts`
 * pulls in three.js (~200 KB gzipped); importing it statically put all of it
 * in /play's initial chunk, ahead of the loading screen. Loaded here instead,
 * in parallel with the bake, as its own chunk (`src/app/chunkSplit.test.ts`).
 */

import { useEffect, useState } from "react";

export type World3dModule = typeof import("./world3d");

export function useWorld3d(): { readonly world: World3dModule | null; readonly error: string | null } {
  const [state, setState] = useState<{ world: World3dModule | null; error: string | null }>({ world: null, error: null });
  useEffect(() => {
    let live = true;
    import("./world3d").then(
      (world) => live && setState({ world, error: null }),
      (e: unknown) => live && setState({ world: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
