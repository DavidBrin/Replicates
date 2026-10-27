import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { NetHud, STALL_HINT_MS } from "./NetHud";

const STATS = { rttMs: 41.6, inputDelay: 3, rollbacks: 12 };

describe("NetHud", () => {
  it("shows ping, input delay and rollbacks", () => {
    render(<NetHud stats={STATS} health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByText("PING 42 ms · DELAY 3f · ROLLBACKS 12")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("is a labelled group", () => {
    render(<NetHud stats={STATS} health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByRole("group", { name: "Connection" })).toBeInTheDocument();
  });

  it("changes the text of one status region that is always there, rather than inserting one", () => {
    const { rerender } = render(<NetHud stats={STATS} health="ok" peerAway={false} stalled={false} />);
    const status = screen.getByRole("status");
    rerender(<NetHud stats={STATS} health="waiting" peerAway={false} stalled={false} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Waiting for opponent…");
    rerender(<NetHud stats={STATS} health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();
  });

  it("keeps the numbers, which change four times a second, out of the live region", () => {
    render(<NetHud stats={STATS} health="waiting" peerAway={false} stalled={false} />);
    const numbers = screen.getByText(/PING/);
    expect(screen.getByRole("status")).not.toContainElement(numbers);
    expect(numbers.closest("[aria-live]")).toBeNull();
  });

  it("says it is waiting when the opponent goes quiet", () => {
    render(<NetHud stats={STATS} health="waiting" peerAway={false} stalled={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for opponent…");
  });

  it("says why when the opponent switched tabs", () => {
    render(<NetHud stats={STATS} health="waiting" peerAway stalled={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Opponent switched tabs…");
  });

  describe("a match held at the prediction cap, with packets still arriving", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Link health reflects silence only, so without this the HUD said nothing for up to ten seconds. */
    it("says it is waiting once the stall has lasted more than a second", () => {
      vi.useFakeTimers();
      const { rerender } = render(<NetHud stats={STATS} health="ok" peerAway={false} stalled={false} />);
      const status = screen.getByRole("status");
      rerender(<NetHud stats={STATS} health="ok" peerAway={false} stalled />);
      act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1));
      expect(status).toBeEmptyDOMElement();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole("status")).toBe(status);
      expect(status).toHaveTextContent("Waiting for opponent…");
    });

    it("says nothing for a short stall, and clears the moment the match moves again", () => {
      vi.useFakeTimers();
      const { rerender } = render(<NetHud stats={STATS} health="ok" peerAway={false} stalled />);
      const status = screen.getByRole("status");
      act(() => vi.advanceTimersByTime(STALL_HINT_MS / 2));
      rerender(<NetHud stats={STATS} health="ok" peerAway={false} stalled={false} />);
      act(() => vi.advanceTimersByTime(STALL_HINT_MS));
      expect(status).toBeEmptyDOMElement();

      rerender(<NetHud stats={STATS} health="ok" peerAway={false} stalled />);
      act(() => vi.advanceTimersByTime(STALL_HINT_MS));
      expect(status).toHaveTextContent("Waiting for opponent…");
      rerender(<NetHud stats={STATS} health="ok" peerAway={false} stalled={false} />);
      expect(status).toBeEmptyDOMElement();
    });

    it("leaves a quiet opponent's own message in place", () => {
      vi.useFakeTimers();
      render(<NetHud stats={STATS} health="waiting" peerAway stalled />);
      act(() => vi.advanceTimersByTime(STALL_HINT_MS));
      expect(screen.getByRole("status")).toHaveTextContent("Opponent switched tabs…");
    });
  });

  it("shows nothing numeric before the first stats arrive", () => {
    render(<NetHud stats={null} health="ok" peerAway={false} stalled={false} />);
    expect(screen.queryByText(/PING/)).toBeNull();
  });
});
