import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedQuote } from "../useDebouncedQuote";
import type { ApiQuote, OrderInput } from "@/lib/api-client";
import { ApiError } from "@/lib/api-client";

const QUOTE: ApiQuote = { shares: 10, cost: 500, avgPrice: 0.5, priceImpact: 0.02, fee: 0 };

describe("useDebouncedQuote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays idle and calls nothing when order is null", () => {
    const fetchQuote = vi.fn();
    const { result } = renderHook(() => useDebouncedQuote("mkt_1", null, fetchQuote));
    expect(result.current).toEqual({ quote: null, prices: null, loading: false, error: null });
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it("waits 150ms before calling fetchQuote", async () => {
    const fetchQuote = vi.fn().mockResolvedValue({ quote: QUOTE, prices: { "out-yes": 0.5 } });
    const order: OrderInput = { outcomeId: "out-yes", side: "buy", budget: 25 };
    renderHook(() => useDebouncedQuote("mkt_1", order, fetchQuote));

    expect(fetchQuote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(149);
    expect(fetchQuote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchQuote).toHaveBeenCalledWith("mkt_1", order);
  });

  it("resolves into quote/prices state once the debounced fetch settles", async () => {
    const fetchQuote = vi.fn().mockResolvedValue({ quote: QUOTE, prices: { "out-yes": 0.5 } });
    const order: OrderInput = { outcomeId: "out-yes", side: "buy", budget: 25 };
    const { result } = renderHook(() => useDebouncedQuote("mkt_1", order, fetchQuote));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.quote).toEqual(QUOTE);
    expect(result.current.prices).toEqual({ "out-yes": 0.5 });
    expect(result.current.error).toBeNull();
  });

  it("cancels a stale in-flight request when order changes before the debounce fires again", async () => {
    const fetchQuote = vi.fn().mockResolvedValue({ quote: QUOTE, prices: {} });
    const orderA: OrderInput = { outcomeId: "out-yes", side: "buy", budget: 10 };
    const orderB: OrderInput = { outcomeId: "out-yes", side: "buy", budget: 20 };

    const { rerender } = renderHook(({ order }) => useDebouncedQuote("mkt_1", order, fetchQuote), {
      initialProps: { order: orderA as OrderInput | null },
    });

    await vi.advanceTimersByTimeAsync(100); // before the 150ms debounce fires
    rerender({ order: orderB });
    await vi.advanceTimersByTimeAsync(150);

    // Only orderB's debounced call should have actually fired.
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    expect(fetchQuote).toHaveBeenCalledWith("mkt_1", orderB);
  });

  it("surfaces an ApiError's message as `error` and clears quote/prices", async () => {
    const fetchQuote = vi.fn().mockRejectedValue(new ApiError({ code: "validation", message: "Below minimum stake." }));
    const order: OrderInput = { outcomeId: "out-yes", side: "buy", budget: 0.5 };
    const { result } = renderHook(() => useDebouncedQuote("mkt_1", order, fetchQuote));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Below minimum stake.");
    expect(result.current.quote).toBeNull();
  });

  it("clears back to idle when order becomes null again", async () => {
    const fetchQuote = vi.fn().mockResolvedValue({ quote: QUOTE, prices: {} });
    const order: OrderInput = { outcomeId: "out-yes", side: "buy", budget: 25 };
    const { result, rerender } = renderHook(({ order }) => useDebouncedQuote("mkt_1", order, fetchQuote), {
      initialProps: { order: order as OrderInput | null },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(result.current.quote).toEqual(QUOTE);

    rerender({ order: null });
    expect(result.current).toEqual({ quote: null, prices: null, loading: false, error: null });
  });
});
