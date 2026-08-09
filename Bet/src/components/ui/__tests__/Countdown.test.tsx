import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Countdown } from "../Countdown";

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recomputes via formatCountdown on mount from the provided clock", () => {
    const target = new Date("2026-08-09T12:00:00.000Z");
    const now = () => new Date("2026-08-09T10:00:00.000Z"); // 2h remaining
    render(<Countdown target={target} initialText="stale" now={now} />);
    expect(screen.getByText("2h")).toBeInTheDocument();
  });

  it("ticks once per minute", () => {
    const target = new Date("2026-08-09T12:02:30.000Z");
    let current = new Date("2026-08-09T12:00:00.000Z");
    render(<Countdown target={target} initialText="stale" now={() => current} />);
    expect(screen.getByText("2m")).toBeInTheDocument();

    current = new Date("2026-08-09T12:01:00.000Z");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("1m")).toBeInTheDocument();
  });

  it("renders 'closed' once the target has passed", () => {
    const target = new Date("2026-08-09T12:00:00.000Z");
    const now = () => new Date("2026-08-09T13:00:00.000Z");
    render(<Countdown target={target} initialText="stale" now={now} />);
    expect(screen.getByText("closed")).toBeInTheDocument();
  });
});
