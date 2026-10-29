"use client";

/**
 * The bake, loaded and installed for a page that plays or prepares a match
 * (Plan 4). `/play` waits for it before mounting; the online lobby starts it on
 * arrival, so the fetch is under way before `connect()` awaits it (ruling R2:
 * the first `hello` must already carry the bake's fingerprint).
 */

import { useEffect, useState } from "react";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { ensureBakeInstalled } from "./bake";

export function useBake(): { readonly tables: BakeTables | null; readonly error: string | null } {
  const [state, setState] = useState<{ tables: BakeTables | null; error: string | null }>({ tables: null, error: null });
  useEffect(() => {
    let live = true;
    ensureBakeInstalled().then(
      (tables) => live && setState({ tables, error: null }),
      (e: unknown) => live && setState({ tables: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
