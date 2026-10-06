import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameSyncBody } from "@/net/types";

/**
 * `/play/online/[gameId]`'s composition (SPEC §7, F26).
 *
 * One behaviour here is worth a test of its own, because it was a real bug and
 * it is invisible from the outside: **the `SyncPort` must be created exactly
 * once per `gameId`.** `createPollingSync` is called from an effect, and its
 * `isMyTurn` callback has to answer a question only the session can answer —
 * so if that callback is rebuilt whenever the poll response changes, the
 * effect re-runs, the port is closed and replaced on *every response*, and
 * `seq` resets to zero each time. The two-window smoke test caught it as
 * `__riskDebug.seq()` never leaving 0; this is the regression guard.
 */

const created: { count: number } = { count: 0 };
let emitSync: ((body: GameSyncBody) => void) | null = null;
let emitSnapshot: ((snapshot: unknown, seq: number) => void) | null = null;
let seq = 0;
const closed = { count: 0 };

vi.mock("@/net/pollingSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/net/pollingSync")>()),
  createPollingSync: vi.fn(() => {
    created.count += 1;
    return {
      poll: async () => undefined,
      submit: async () => [],
      submitIntent: async () => [],
      onActions: () => () => undefined,
      onStatus: () => () => undefined,
      onSnapshot: (listener: (snapshot: unknown, at: number) => void) => {
        emitSnapshot = listener;
        return () => {
          emitSnapshot = null;
        };
      },
      onSync: (listener: (body: GameSyncBody) => void) => {
        emitSync = listener;
        return () => {
          emitSync = null;
        };
      },
      setIntervalMs: () => undefined,
      say: async () => undefined,
      resign: async () => [],
      close: () => {
        closed.count += 1;
      },
      get seq() {
        return seq;
      },
      chatSince: 0,
      lastDelayMs: 0,
    };
  }),
}));

// The map catalogue and the session runner are not what is under test, and
// `createSession` throwing is the path that renders the status panel.
vi.mock("@/net/mapClient", () => ({
  loadMapForSlug: async () => ({ slug: "tiny4", territories: [], continents: [] }),
  MapUnavailableError: class extends Error {},
}));

function syncBody(overrides: Partial<GameSyncBody> = {}): GameSyncBody {
  return {
    seq: 1,
    actions: [],
    presence: [],
    turnDeadline: null,
    chat: [],
    you: { seat: 0, cards: [] },
    status: "playing",
    ...overrides,
  };
}

let OnlineGame: typeof import("../OnlineGame").default;

beforeEach(async () => {
  created.count = 0;
  closed.count = 0;
  seq = 0;
  emitSync = null;
  emitSnapshot = null;
  OnlineGame = (await import("../OnlineGame")).default;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("OnlineGame", () => {
  it("creates the SyncPort once and keeps it across many poll responses", async () => {
    render(<OnlineGame gameId="g_1" />);
    await waitFor(() => expect(created.count).toBe(1));

    for (let i = 1; i <= 5; i += 1) {
      seq = i;
      emitSync?.(syncBody({ seq: i }));
      await waitFor(() => expect(screen.getByTestId("online-seq").textContent).toBe(String(i)));
    }

    // The whole point: one port, never closed and re-made under the poll.
    expect(created.count).toBe(1);
    expect(closed.count).toBe(0);
  });

  it("shows the connecting panel with the seq, seat and status it was given", async () => {
    render(<OnlineGame gameId="g_1" />);
    await waitFor(() => expect(created.count).toBe(1));

    emitSync?.(syncBody({ seq: 7, you: { seat: 1, cards: [] }, status: "playing" }));
    await waitFor(() => {
      expect(screen.getByTestId("online-seq").textContent).toBe("7");
    });
    expect(screen.getByTestId("online-seat").textContent).toBe("1");
    expect(screen.getByTestId("online-status").textContent).toBe("playing");
  });

  it("falls back to a readable panel when the session runner refuses to start", async () => {
    render(<OnlineGame gameId="g_1" />);
    await waitFor(() => expect(created.count).toBe(1));

    // S4's `createSession` throws while that slice is in flight; the route
    // still polls, which is what keeps `__riskDebug` drivable meanwhile.
    emitSnapshot?.(
      { mapSlug: "tiny4", rules: { diceMode: "balancedBlitz" }, seats: [], turn: 1 },
      1,
    );
    await waitFor(() =>
      expect(screen.getByTestId("online-game-status").dataset.status).toMatch(
        /connecting|unavailable/,
      ),
    );
    expect(created.count).toBe(1);
  });

  it("closes the port on unmount", async () => {
    const view = render(<OnlineGame gameId="g_1" />);
    await waitFor(() => expect(created.count).toBe(1));
    view.unmount();
    expect(closed.count).toBe(1);
  });
});
