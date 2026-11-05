import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { NetHud, STALL_HINT_MS } from "./NetHud";

const STATS = { rttMs: 41.6, inputDelay: 3, rollbacks: 12 };

describe("NetHud", () => {
  it("shows ping, input delay and rollbacks", () => {
    render(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByText(/^PING /)).toHaveTextContent(/^PING 42 ms · DELAY 3f · ROLLBACKS 12 · DIRECT$/);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("names the route after the numbers", () => {
    const stats = { rttMs: 41.6, inputDelay: 3, rollbacks: 2 };
    const { rerender } = render(<NetHud stats={stats} route="relay" health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByText(/^PING /)).toHaveTextContent(/^PING 42 ms · DELAY 3f · ROLLBACKS 2 · RELAY$/);
    rerender(<NetHud stats={stats} route="direct" health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByText(/^PING /)).toHaveTextContent(/^PING 42 ms · DELAY 3f · ROLLBACKS 2 · DIRECT$/);
  });

  /**
   * On a narrow phone the numbers wrap. The tag and its separator are one
   * unbreakable unit, so the line breaks before the `·`, never between it and
   * the word, which would strand a dot at the end of a line.
   */
  it("keeps the route tag and its separator in one element that does not wrap", () => {
    const stats = { rttMs: 41.6, inputDelay: 3, rollbacks: 2 };
    const { rerender } = render(<NetHud stats={stats} route="relay" health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByText("· RELAY")).toHaveClass("whitespace-nowrap");
    rerender(<NetHud stats={stats} route="direct" health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByText("· DIRECT")).toHaveClass("whitespace-nowrap");
  });

  it("is a labelled group", () => {
    render(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByRole("group", { name: "Connection" })).toBeInTheDocument();
  });

  it("changes the text of one status region that is always there, rather than inserting one", () => {
    const { rerender } = render(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled={false} />);
    const status = screen.getByRole("status");
    rerender(<NetHud route="direct" stats={STATS} health="waiting" peerAway={false} stalled={false} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Waiting for opponent…");
    rerender(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled={false} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();
  });

  it("keeps the numbers, which change four times a second, out of the live region", () => {
    render(<NetHud route="direct" stats={STATS} health="waiting" peerAway={false} stalled={false} />);
    const numbers = screen.getByText(/PING/);
    expect(screen.getByRole("status")).not.toContainElement(numbers);
    expect(numbers.closest("[aria-live]")).toBeNull();
  });

  it("says it is waiting when the opponent goes quiet", () => {
    render(<NetHud route="direct" stats={STATS} health="waiting" peerAway={false} stalled={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for opponent…");
  });

  it("says why when the opponent switched tabs", () => {
    render(<NetHud route="direct" stats={STATS} health="waiting" peerAway stalled={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Opponent switched tabs…");
  });

  describe("a match held at the prediction cap, with packets still arriving", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Link health reflects silence only, so without this the HUD said nothing for up to ten seconds. */
    it("says it is waiting once the stall has lasted more than a second", () => {
      vi.useFakeTimers();
      const { rerender } = render(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled={false} />);
      const status = screen.getByRole("status");
      rerender(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled />);
      act(() => vi.advanceTimersByTime(STALL_HINT_MS - 1));
      expect(status).toBeEmptyDOMElement();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole("status")).toBe(status);
      expect(status).toHaveTextContent("Waiting for opponent…");
    });

    it("says nothing for a short stall, and clears the moment the match moves again", () => {
      vi.useFakeTimers();
      const { rerender } = render(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled />);
      const status = screen.getByRole("status");
      act(() => vi.advanceTimersByTime(STALL_HINT_MS / 2));
      rerender(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled={false} />);
      act(() => vi.advanceTimersByTime(STALL_HINT_MS));
      expect(status).toBeEmptyDOMElement();

      rerender(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled />);
      act(() => vi.advanceTimersByTime(STALL_HINT_MS));
      expect(status).toHaveTextContent("Waiting for opponent…");
      rerender(<NetHud route="direct" stats={STATS} health="ok" peerAway={false} stalled={false} />);
      expect(status).toBeEmptyDOMElement();
    });

    it("leaves a quiet opponent's own message in place", () => {
      vi.useFakeTimers();
      render(<NetHud route="direct" stats={STATS} health="waiting" peerAway stalled />);
      act(() => vi.advanceTimersByTime(STALL_HINT_MS));
      expect(screen.getByRole("status")).toHaveTextContent("Opponent switched tabs…");
    });
  });

  it("shows nothing numeric before the first stats arrive", () => {
    render(<NetHud route="direct" stats={null} health="ok" peerAway={false} stalled={false} />);
    expect(screen.queryByText(/PING/)).toBeNull();
  });
});
