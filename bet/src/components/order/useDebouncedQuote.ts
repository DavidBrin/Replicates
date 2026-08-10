"use client";

import { useEffect, useState } from "react";
import { ApiError, getQuote, type ApiQuote, type OrderInput } from "@/lib/api-client";

export interface UseDebouncedQuoteResult {
  quote: ApiQuote | null;
  prices: Record<string, number> | null;
  loading: boolean;
  error: string | null;
}

/** SPEC §5.2 / Task 10's brief: "a live quote debounced 150ms". */
const DEBOUNCE_MS = 150;

const IDLE: UseDebouncedQuoteResult = { quote: null, prices: null, loading: false, error: null };

/**
 * Debounces `order` and re-fetches `POST /quote` (via `@/lib/api-client`)
 * `DEBOUNCE_MS` after the last change, cancelling any in-flight/stale
 * request when `order` changes again before it resolves. `order === null`
 * means "nothing valid to quote yet" (e.g. empty amount field) and clears
 * to `IDLE` without a network call.
 *
 * `fetchQuote` is dependency-injected (defaults to the real `getQuote`)
 * purely so this hook is unit-testable with a mock instead of a real
 * `fetch` — the same pattern the domain layer uses for `Clock`/`IdGen`.
 */
export function useDebouncedQuote(
  marketId: string,
  order: OrderInput | null,
  fetchQuote: (marketId: string, order: OrderInput) => Promise<{ quote: ApiQuote; prices: Record<string, number> }> = getQuote,
): UseDebouncedQuoteResult {
  const [state, setState] = useState<UseDebouncedQuoteResult>(IDLE);
  // Order objects are re-created every render by the caller; comparing by
  // value (not identity) is what actually determines whether a re-fetch is
  // warranted.
  const orderKey = order ? JSON.stringify(order) : null;

  useEffect(() => {
    // Nothing to fetch — the render below returns `IDLE` directly rather
    // than mirroring that back into `state` here (calling `setState`
    // synchronously at the top of an effect body, with no async boundary,
    // is exactly the "adjusting state in response to a change" anti-pattern
    // React's docs warn against; computing it at render time instead needs
    // no effect at all for this branch).
    if (!order) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      // Flips `loading` only once the debounce actually elapses and a
      // fetch is about to start — both this and the two `.then`/`.catch`
      // calls below run inside genuine async callbacks, not synchronously
      // in the effect body.
      setState((prev) => ({ ...prev, loading: true, error: null }));
      fetchQuote(marketId, order)
        .then((res) => {
          if (cancelled) return;
          setState({ quote: res.quote, prices: res.prices, loading: false, error: null });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message = err instanceof ApiError ? err.message : "Couldn't get a quote.";
          setState({ quote: null, prices: null, loading: false, error: message });
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, orderKey, fetchQuote]);

  return order ? state : IDLE;
}
