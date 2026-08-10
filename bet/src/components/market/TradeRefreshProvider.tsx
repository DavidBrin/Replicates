"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

interface TradeRefreshContextValue {
  /** Increments every time `notify()` fires — `RoomPanel` watches this to
   * trigger an immediate re-poll instead of waiting for its next scheduled
   * tick. */
  tick: number;
  /** Call after a successful trade or resolution action: refreshes every
   * Server Component on the page (balance in the top bar, prices,
   * positions, holders, resolution state) via `router.refresh()`, and bumps
   * `tick` for client-side listeners. */
  notify: () => void;
}

const TradeRefreshContext = createContext<TradeRefreshContextValue | null>(null);

/**
 * The one client boundary shared by `OrderTicket`, `ResolutionPanel` and
 * `RoomPanel` (siblings under the market page's Server Component) so a
 * trade or a resolution action can refresh all three without prop-drilling
 * a callback through every layer between them. See SPEC §3.3 / Task 10's
 * brief: "success refreshes the panel, balance, positions and Room."
 */
export function TradeRefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [tick, setTick] = useState(0);

  const notify = useCallback(() => {
    setTick((t) => t + 1);
    router.refresh();
  }, [router]);

  const value = useMemo(() => ({ tick, notify }), [tick, notify]);

  return <TradeRefreshContext.Provider value={value}>{children}</TradeRefreshContext.Provider>;
}

export function useTradeRefresh(): TradeRefreshContextValue {
  const ctx = useContext(TradeRefreshContext);
  if (!ctx) throw new Error("useTradeRefresh() must be used within a <TradeRefreshProvider>");
  return ctx;
}
