import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { resetRosterCache, useMatchConfig, type MatchResult } from "@/lib/matchConfig";
import { ONLINE_RESULT_LINGER_MS, leaveOnline } from "@/lib/onlineStore";
import { getActiveSession, setActiveSession } from "@/net/online/session";
import { fakeSession } from "@/net/online/testing";
import { Results } from "./Results";

// The real leave, counted: "exactly one leave" is a claim about calls, and the
// session's own `close` cannot show it (a second leave finds nothing to close).
vi.mock("@/lib/onlineStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/onlineStore")>();
  return { ...actual, leaveOnline: vi.fn(actual.leaveOnline) };
});

const RESULT: MatchResult = {
  kind: "stockOut",
  // P2 won; the placings array is in finishing order, not port order.
  placings: [1, 0],
  stats: [
    { port: 0, kos: 2, falls: 3, sds: 1 },
    { port: 1, kos: 3, falls: 2, sds: 0 },
  ],
  fighters: { 0: "mario", 1: "fox" },
};

async function renderResults() {
  render(<Results />);
  await act(async () => {});
}

beforeEach(() => {
  useMatchConfig.getState().reset();
  resetRosterCache();
  routerMock.push.mockClear();
  setActiveSession(null);
  vi.mocked(leaveOnline).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Results", () => {
  it("says so plainly when no match has been played", async () => {
    await renderResults();
    expect(screen.getByRole("heading", { name: /no match yet/i })).toBeInTheDocument();
  });

  it("ranks by finishing order rather than by port", async () => {
    useMatchConfig.getState().setResult(RESULT);
    await renderResults();

    const places = screen.getAllByRole("listitem");
    expect(places[0]).toHaveTextContent("1st");
    expect(places[0]).toHaveTextContent("P2");
    expect(places[1]).toHaveTextContent("2nd");
    expect(places[1]).toHaveTextContent("P1");
  });

  /** KOs, falls and SDs are three different facts and are reported as three. */
  it("reports KOs, falls and self-destructs apart", async () => {
    useMatchConfig.getState().setResult(RESULT);
    await renderResults();

    const winner = screen.getAllByRole("listitem")[0];
    expect(winner).toHaveTextContent("KOs");
    expect(winner).toHaveTextContent("Falls");
    expect(winner).toHaveTextContent("SDs");
  });

  it("offers a rematch, a change of fighters, and a way out", async () => {
    useMatchConfig.getState().setResult(RESULT);
    await renderResults();

    fireEvent.click(screen.getByRole("button", { name: /rematch/i }));
    expect(routerMock.push).toHaveBeenCalledWith("/play");

    fireEvent.click(screen.getByRole("button", { name: /change fighters/i }));
    expect(routerMock.push).toHaveBeenCalledWith("/fighters");

    fireEvent.click(screen.getByRole("button", { name: /^quit$/i }));
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
    expect(screen.queryByRole("button", { name: /play online again/i })).toBeNull();
  });
});

describe("Results after an online match", () => {
  const LOST: MatchResult = { kind: "connectionLost", placings: [], stats: [], fighters: { 0: "mario", 1: "fox" }, online: true };

  it("says the connection was lost instead of crowning anyone", async () => {
    useMatchConfig.getState().setResult(LOST);
    await renderResults();
    expect(screen.getByText("Connection Lost")).toBeInTheDocument();
    expect(await screen.findByText(/connection to the other player was lost/i)).toBe(screen.getByRole("status"));
    expect(screen.queryByRole("button", { name: /rematch/i })).toBeNull();
  });

  /** A status region announces a change to one it already knows, not one that arrives with its text in it. */
  it("says it in a status region that was already there, empty, when the screen arrived", async () => {
    vi.useFakeTimers();
    useMatchConfig.getState().setResult(LOST);
    render(<Results />);
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent(/connection to the other player was lost/i);
  });

  describe("after the two games went out of sync", () => {
    const DESYNC: MatchResult = { kind: "desync", placings: [], stats: [], fighters: { 0: "mario", 1: "fox" }, online: true };

    it("says plainly the match cannot count, with no placings and no rules", async () => {
      useMatchConfig.getState().setResult(DESYNC);
      await renderResults();
      expect(screen.getByText("Out of Sync")).toBeInTheDocument();
      expect(await screen.findByText("The two games went out of sync, so this match can't count.")).toBe(screen.getByRole("status"));
      expect(screen.queryByRole("list")).toBeNull();
      expect(screen.queryByText(/match ·/)).toBeNull();
      expect(screen.getByRole("button", { name: /play online again/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /quit/i })).toBeInTheDocument();
    });

    it("leaves the room at once, with nobody left to wait for", async () => {
      vi.useFakeTimers();
      const { session } = fakeSession("host");
      setActiveSession(session);
      useMatchConfig.getState().setResult(DESYNC);
      render(<Results />);
      await act(async () => {});
      expect(leaveOnline).toHaveBeenCalledTimes(1);
      expect(session.close).toHaveBeenCalledTimes(1);
    });
  });

  it("shows no empty placings and no rules for a match that never finished", async () => {
    useMatchConfig.getState().setResult(LOST);
    await renderResults();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/match ·/)).toBeNull();
    expect(screen.getByRole("button", { name: /quit/i })).toBeInTheDocument();
  });

  it("keeps the status region, saying nothing, after a match that finished", async () => {
    vi.useFakeTimers();
    useMatchConfig.getState().setResult({ ...RESULT, online: true });
    render(<Results />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("offers to play online again, which leaves this room for the lobby", async () => {
    const { session } = fakeSession("guest");
    setActiveSession(session);
    useMatchConfig.getState().setResult({ ...RESULT, online: true });
    await renderResults();
    fireEvent.click(screen.getByRole("button", { name: /play online again/i }));
    expect(session.close).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
    expect(routerMock.push).toHaveBeenCalledWith("/online");
  });

  /** The guest's own config still holds whatever it last set locally; the match ran on the host's. */
  it("states the rules the match was played under, not this machine's own", async () => {
    useMatchConfig.getState().setMode("stock");
    useMatchConfig.getState().setStocks(3);
    useMatchConfig.getState().setSmashBall(true);
    const hosts = { mode: "time", stocks: 3, timeLimit: 7200, smashBall: false, oneOnOne: true } as const;
    useMatchConfig.getState().setResult({ ...RESULT, rules: hosts, online: true });
    await renderResults();
    expect(screen.getByText(/match ·/)).toHaveTextContent("Timed match · 1v1 damage 1.2× · Smash Ball off");
  });

  it("falls back to this machine's rules for a result that carries none", async () => {
    useMatchConfig.getState().setStocks(2);
    useMatchConfig.getState().setResult(RESULT);
    await renderResults();
    expect(screen.getByText(/match ·/)).toHaveTextContent(/^2-stock match/);
  });

  it("offers no local rematch or fighter change after an online match", async () => {
    useMatchConfig.getState().setResult({ ...RESULT, online: true });
    await renderResults();
    expect(screen.queryByRole("button", { name: /rematch/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /change fighters/i })).toBeNull();
    expect(screen.getByRole("button", { name: /quit/i })).toBeInTheDocument();
  });

  it("leaves the room when quitting", async () => {
    const { session } = fakeSession("host");
    setActiveSession(session);
    useMatchConfig.getState().setResult({ ...RESULT, online: true });
    await renderResults();
    fireEvent.click(screen.getByRole("button", { name: /quit/i }));
    expect(session.close).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
  });

  it("leaves the room from the back button too", async () => {
    const { session } = fakeSession("guest");
    setActiveSession(session);
    useMatchConfig.getState().setResult({ ...RESULT, online: true });
    await renderResults();
    fireEvent.click(screen.getByRole("button", { name: "Back to the main menu" }));
    expect(session.close).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
  });

  it("leaves at once, and only once, when the connection was lost", async () => {
    vi.useFakeTimers();
    const { session } = fakeSession("guest");
    setActiveSession(session);
    useMatchConfig.getState().setResult({ kind: "connectionLost", placings: [], stats: [], fighters: { 0: "mario", 1: "fox" }, online: true });
    const { unmount } = render(<Results />);
    await act(async () => {});

    expect(leaveOnline).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(getActiveSession()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /quit/i }));
    act(() => {
      vi.advanceTimersByTime(ONLINE_RESULT_LINGER_MS * 2);
    });
    unmount();
    expect(leaveOnline).toHaveBeenCalledTimes(1);
  });

  describe("lingering before it leaves", () => {
    /** An online match that ended normally, seated as the match page leaves it. */
    function seatFinishedOnlineMatch() {
      const fake = fakeSession("host");
      setActiveSession(fake.session);
      useMatchConfig.getState().configureOnline();
      useMatchConfig.getState().setResult({ ...RESULT, online: true });
      return fake.session;
    }

    /** The other peer may still need this side's last input packets, so the room stays up for a moment. */
    it("holds the room open for the grace, then leaves exactly once", async () => {
      vi.useFakeTimers();
      const session = seatFinishedOnlineMatch();
      const { unmount } = render(<Results />);
      await act(async () => {});

      expect(leaveOnline).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1_499);
      });
      expect(leaveOnline).not.toHaveBeenCalled();
      expect(session.close).not.toHaveBeenCalled();
      expect(getActiveSession()).toBe(session);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(leaveOnline).toHaveBeenCalledTimes(1);
      expect(session.close).toHaveBeenCalledTimes(1);
      expect(getActiveSession()).toBeNull();

      act(() => {
        vi.advanceTimersByTime(ONLINE_RESULT_LINGER_MS * 2);
      });
      unmount();
      expect(leaveOnline).toHaveBeenCalledTimes(1);
    });

    it("keeps showing the result after it has left the room", async () => {
      vi.useFakeTimers();
      seatFinishedOnlineMatch();
      render(<Results />);
      await act(async () => {});
      act(() => {
        vi.advanceTimersByTime(ONLINE_RESULT_LINGER_MS);
      });

      expect(useMatchConfig.getState().online).toBe(false);
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("1st");
      expect(screen.queryByRole("heading", { name: /no match yet/i })).toBeNull();
    });

    it("leaves at once, and only once, when the player quits before the grace is up", async () => {
      vi.useFakeTimers();
      const session = seatFinishedOnlineMatch();
      const { unmount } = render(<Results />);
      await act(async () => {});

      fireEvent.click(screen.getByRole("button", { name: /quit/i }));
      expect(leaveOnline).toHaveBeenCalledTimes(1);
      expect(session.close).toHaveBeenCalledTimes(1);
      expect(routerMock.push).toHaveBeenCalledWith("/menu");

      act(() => {
        vi.advanceTimersByTime(ONLINE_RESULT_LINGER_MS * 2);
      });
      unmount();
      expect(leaveOnline).toHaveBeenCalledTimes(1);
    });

    it("leaves at once, and only once, from the back button before the grace is up", async () => {
      vi.useFakeTimers();
      seatFinishedOnlineMatch();
      const { unmount } = render(<Results />);
      await act(async () => {});

      fireEvent.click(screen.getByRole("button", { name: "Back to the main menu" }));
      expect(leaveOnline).toHaveBeenCalledTimes(1);
      expect(getActiveSession()).toBeNull();

      act(() => {
        vi.advanceTimersByTime(ONLINE_RESULT_LINGER_MS * 2);
      });
      unmount();
      expect(leaveOnline).toHaveBeenCalledTimes(1);
    });

    it("leaves at once, and only once, when the screen unmounts before the grace is up", async () => {
      vi.useFakeTimers();
      const session = seatFinishedOnlineMatch();
      const { unmount } = render(<Results />);
      await act(async () => {});
      act(() => {
        vi.advanceTimersByTime(ONLINE_RESULT_LINGER_MS - 1);
      });
      expect(leaveOnline).not.toHaveBeenCalled();

      unmount();
      expect(leaveOnline).toHaveBeenCalledTimes(1);
      expect(session.close).toHaveBeenCalledTimes(1);
      expect(getActiveSession()).toBeNull();

      // The cleared timer must not leave a second time.
      act(() => {
        vi.advanceTimersByTime(ONLINE_RESULT_LINGER_MS * 2);
      });
      expect(leaveOnline).toHaveBeenCalledTimes(1);
    });
  });

  it("never leaves a room after a local match", async () => {
    vi.useFakeTimers();
    const { session } = fakeSession("host");
    setActiveSession(session);
    useMatchConfig.getState().setResult(RESULT);
    const { unmount } = render(<Results />);
    await act(async () => {});
    act(() => {
      vi.advanceTimersByTime(ONLINE_RESULT_LINGER_MS * 2);
    });
    fireEvent.click(screen.getByRole("button", { name: /^quit$/i }));
    unmount();

    expect(leaveOnline).not.toHaveBeenCalled();
    expect(session.close).not.toHaveBeenCalled();
  });
});
