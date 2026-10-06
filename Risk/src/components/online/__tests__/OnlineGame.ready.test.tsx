import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameState } from "@/engine/types";
import type { GameSyncBody } from "@/net/types";
import type { ChatLine, PresenceRow } from "@/ports/sync";

/**
 * `/play/online/[gameId]` once the board is up (SPEC §5.5, §5.9, §7).
 *
 * The sibling suite covers the connecting panel and the one-port-per-`gameId`
 * rule with the **real** session runner refusing to start. This one mocks the
 * runner and `GameScreen` so the screen can actually reach `ready`, which is
 * the only place three behaviours are visible:
 *
 * - **game chat accumulates.** POLL 3 sends only the lines newer than
 *   `chatSince`, so rendering the latest body's array emptied the drawer on
 *   the next poll.
 * - **the snapshot is not render state.** `GameState` goes to the session and
 *   nowhere near a prop.
 * - **an eliminated viewer is offered "watch"** rather than silently stopping.
 *
 * Plus the one bug that is only visible *between* the polls: the map load is
 * awaited, and an unmount in that window used to go on to build a session on
 * a closed port.
 */

/* ---------------------------------------------------------------- the port -- */

let emitSync: ((body: GameSyncBody) => void) | null = null;
let emitSnapshot: ((snapshot: unknown, at: number) => void) | null = null;
const watched = { count: 0 };
const closed = { count: 0 };

vi.mock("@/net/pollingSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/net/pollingSync")>()),
  createPollingSync: vi.fn(() => ({
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
    eliminated: false,
    watch: () => {
      watched.count += 1;
    },
    close: () => {
      closed.count += 1;
    },
    seq: 0,
    chatSince: 0,
    lastDelayMs: 0,
  })),
}));

/* ------------------------------------------------------------- the map load -- */

/** A deferred map load, so a test can unmount while it is still pending. */
let releaseMap: (() => void) | null = null;
let mapMode: "immediate" | "deferred" = "immediate";

vi.mock("@/net/mapClient", () => ({
  loadMapForSlug: vi.fn(async () => {
    if (mapMode === "deferred") {
      await new Promise<void>((resolve) => {
        releaseMap = resolve;
      });
    }
    return { slug: "tiny4", territories: [], continents: [] };
  }),
  MapUnavailableError: class extends Error {},
}));

/* --------------------------------------------------------- the session runner -- */

const sessions: {
  count: number;
  snapshots: unknown[];
  /** Every `ingest` / `ingestSnapshot` on the catch-up, in order. */
  log: string[];
} = { count: 0, snapshots: [], log: [] };

vi.mock("@/game/session", () => ({
  createSession: vi.fn(() => {
    sessions.count += 1;
    return {
      start: () => undefined,
      destroy: () => undefined,
      confirmed: () => ({ turnOrder: [0], currentIndex: 0 }) as unknown as GameState,
      mySeat: () => 0,
      ingest: (rows: readonly { seq: number }[]) => {
        sessions.log.push(`actions:${rows.map((row) => row.seq).join(",")}`);
      },
      ingestSnapshot: (
        snapshot: unknown,
        at: number,
        animate?: readonly { seq: number }[],
      ) => {
        sessions.snapshots.push(snapshot);
        sessions.log.push(
          animate === undefined
            ? `snapshot:${at}`
            : `snapshot:${at}+animate:${animate.map((r) => r.seq).join(",")}`,
        );
      },
    };
  }),
}));

/* ------------------------------------------------------------- GameScreen -- */

/**
 * The props `GameScreen` was handed on its last render, so a test can assert
 * what reached it — and, just as importantly, what did not.
 */
let lastProps: Record<string, unknown> = {};

vi.mock("@/components/game/GameScreen", () => ({
  default: (props: Record<string, unknown>) => {
    lastProps = props;
    const chat = (props.chat ?? []) as readonly ChatLine[];
    return (
      <div data-testid="fake-game-screen">
        <span data-testid="fake-chat-count">{chat.length}</span>
        <span data-testid="fake-chat-ids">{chat.map((line) => line.id).join(",")}</span>
      </div>
    );
  },
}));

/* ------------------------------------------------------------ scaffolding -- */

function snapshot(): GameState {
  return {
    mapSlug: "tiny4",
    rules: { diceMode: "balancedBlitz", fogOfWar: false },
    seats: [],
    turn: 1,
  } as unknown as GameState;
}

function line(id: number): ChatLine {
  return {
    id,
    scope: "game",
    displayName: "Alpha",
    lineId: 20,
    emoji: null,
    createdAt: "2026-10-05T12:00:00.000Z",
  };
}

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

/** The cold poll: the snapshot and `you.seat` in one body, as the server sends it. */
function coldBody(overrides: Partial<GameSyncBody> = {}): GameSyncBody {
  return syncBody({ snapshot: snapshot(), snapshotSeq: 1, ...overrides });
}

let OnlineGame: typeof import("../OnlineGame").default;

beforeEach(async () => {
  emitSync = null;
  emitSnapshot = null;
  watched.count = 0;
  closed.count = 0;
  sessions.count = 0;
  sessions.snapshots = [];
  sessions.log = [];
  lastProps = {};
  releaseMap = null;
  mapMode = "immediate";
  OnlineGame = (await import("../OnlineGame")).default;
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Render, hand over the cold body, and wait for the board. */
async function mounted(): Promise<void> {
  render(<OnlineGame gameId="g_1" />);
  await waitFor(() => expect(emitSync).not.toBeNull());
  await act(async () => {
    emitSync?.(coldBody());
  });
  await waitFor(() => expect(screen.getByTestId("fake-game-screen")).toBeTruthy());
}

/* ------------------------------------------------------------------ tests -- */

describe("the game chat drawer", () => {
  it("accumulates the deltas instead of rendering only the latest body", async () => {
    await mounted();

    await act(async () => {
      emitSync?.(syncBody({ seq: 2, chat: [line(1), line(2)] }));
    });
    await waitFor(() => expect(screen.getByTestId("fake-chat-ids").textContent).toBe("1,2"));

    // The next body carries only the newer line. Rendering `body.chat` alone
    // is what made the first two disappear after one interval.
    await act(async () => {
      emitSync?.(syncBody({ seq: 3, chat: [line(3)] }));
    });
    await waitFor(() => expect(screen.getByTestId("fake-chat-ids").textContent).toBe("1,2,3"));
  });

  it("dedupes by id when a response repeats a line", async () => {
    await mounted();

    await act(async () => {
      emitSync?.(syncBody({ seq: 2, chat: [line(1), line(2)] }));
      emitSync?.(syncBody({ seq: 3, chat: [line(2), line(3)] }));
    });
    await waitFor(() => expect(screen.getByTestId("fake-chat-ids").textContent).toBe("1,2,3"));
  });

  it("keeps the newest 200 lines and no more", async () => {
    await mounted();

    await act(async () => {
      for (let i = 1; i <= 250; i += 1) emitSync?.(syncBody({ seq: 1 + i, chat: [line(i)] }));
    });
    await waitFor(() => expect(screen.getByTestId("fake-chat-count").textContent).toBe("200"));
    const ids = screen.getByTestId("fake-chat-ids").textContent?.split(",") ?? [];
    expect(ids[0]).toBe("51");
    expect(ids.at(-1)).toBe("250");
  });
});

describe("what reaches GameScreen", () => {
  it("passes presence, the deadline and the chat — and never the snapshot", async () => {
    await mounted();

    const presence: readonly PresenceRow[] = [
      { seat: 0, standing: "active", online: true, missedTurns: 0 },
    ];
    await act(async () => {
      emitSync?.(
        syncBody({
          seq: 4,
          presence,
          turnDeadline: "2026-10-05T12:00:00.000Z",
          chat: [line(7)],
          // A fresh snapshot on a later poll, as a fog game sends on every one.
          snapshot: snapshot(),
          snapshotSeq: 4,
        }),
      );
    });
    await waitFor(() => expect(lastProps.turnDeadline).toBe("2026-10-05T12:00:00.000Z"));

    expect(lastProps.presence).toEqual(presence);
    expect((lastProps.chat as readonly ChatLine[]).map((l) => l.id)).toEqual([7]);
    // The POLL 3 body — `snapshot: GameState` and all — stays in a ref: the
    // only thing that ever wanted it is `session.ingestSnapshot`.
    expect(lastProps.snapshot).toBeUndefined();
    expect(Object.keys(lastProps).sort()).toEqual([
      "chat",
      "onChat",
      "presence",
      "session",
      "sync",
      "turnDeadline",
    ]);
  });

  it("replays the pre-session snapshot into the session rather than into state", async () => {
    await mounted();
    expect(sessions.count).toBe(1);
    expect(sessions.snapshots).toHaveLength(1);
  });
});

describe("an eliminated viewer", () => {
  function eliminatedBody(): GameSyncBody {
    return syncBody({
      seq: 5,
      you: { seat: 0, cards: [] },
      presence: [{ seat: 0, standing: "eliminated", online: true, missedTurns: 0 }],
    });
  }

  it("offers 'watch' once its own seat is out", async () => {
    await mounted();
    expect(screen.queryByTestId("online-eliminated")).toBeNull();

    await act(async () => {
      emitSync?.(eliminatedBody());
    });
    await waitFor(() => expect(screen.getByTestId("online-eliminated")).toBeTruthy());
  });

  it("resumes the port on 'watch' and takes the affordance away", async () => {
    await mounted();
    await act(async () => {
      emitSync?.(eliminatedBody());
    });
    await waitFor(() => expect(screen.getByTestId("online-watch")).toBeTruthy());

    await act(async () => {
      screen.getByTestId("online-watch").click();
    });
    await waitFor(() => expect(screen.queryByTestId("online-eliminated")).toBeNull());
    expect(watched.count).toBe(1);
  });

  it("offers nothing once the game itself is over", async () => {
    await mounted();
    await act(async () => {
      emitSync?.({ ...eliminatedBody(), status: "finished" });
    });
    await waitFor(() => expect(screen.getByTestId("fake-game-screen")).toBeTruthy());
    expect(screen.queryByTestId("online-eliminated")).toBeNull();
  });

  it("leaves an active viewer alone while another seat is eliminated", async () => {
    await mounted();
    await act(async () => {
      emitSync?.(
        syncBody({
          seq: 5,
          you: { seat: 0, cards: [] },
          presence: [
            { seat: 0, standing: "active", online: true, missedTurns: 0 },
            { seat: 1, standing: "eliminated", online: true, missedTurns: 0 },
          ],
        }),
      );
    });
    await waitFor(() => expect(screen.getByTestId("fake-game-screen")).toBeTruthy());
    expect(screen.queryByTestId("online-eliminated")).toBeNull();
  });
});

describe("catching the new session up on the buffered bodies", () => {
  /** A `LoggedAction` row with whatever payload a test needs. */
  function row(at: number, payload: unknown) {
    return {
      seq: at,
      seat: 0,
      action: payload,
      actor: "human" as const,
      clientActionId: null,
      stateHash: `h${at}`,
    } as unknown as GameSyncBody["actions"][number];
  }

  it("replays an authoritative snapshot first and the actions on top of it", async () => {
    mapMode = "deferred";
    render(<OnlineGame gameId="g_1" />);
    await waitFor(() => expect(emitSync).not.toBeNull());
    await act(async () => {
      emitSync?.(coldBody({ seq: 3, snapshotSeq: 1, actions: [row(2, { type: "END_TURN", seat: 0 })] }));
    });
    await waitFor(() => expect(releaseMap).not.toBeNull());
    await act(async () => {
      releaseMap?.();
    });
    await waitFor(() => expect(sessions.count).toBe(1));

    // An authoritative snapshot keeps snapshot-then-fold, and carries no
    // `animate` argument: its rows are a real delta.
    expect(sessions.log).toEqual(["snapshot:1", "actions:2"]);
  });

  it("replays a masked view's actions AS the view's animation, dropping the unfoldable rows", async () => {
    mapMode = "deferred";
    render(<OnlineGame gameId="g_1" />);
    await waitFor(() => expect(emitSync).not.toBeNull());
    await act(async () => {
      emitSync?.(
        syncBody({
          seq: 9,
          // A fog body: the masked view at the head seq, plus the actions since
          // `since` for animation only.
          snapshot: {
            mapSlug: "tiny4",
            rules: { diceMode: "balancedBlitz", fogOfWar: true },
            seats: [],
            turn: 1,
            fogged: true,
          } as unknown as GameState,
          snapshotSeq: 9,
          actions: [
            row(7, { type: "HIDDEN", seat: 2 }),
            row(8, { type: "CARD_DRAWN", seat: 2, card: null }),
            row(9, { type: "END_TURN", seat: 0 }),
          ],
        }),
      );
    });
    await waitFor(() => expect(releaseMap).not.toBeNull());
    await act(async () => {
      releaseMap?.();
    });
    await waitFor(() => expect(sessions.count).toBe(1));

    // A masked view's rows are animation, never a delta: they do not apply to
    // a masked state, so `ingest` would refuse them and the session would read
    // the refusal as a desync. They ride the snapshot as `ingestSnapshot`'s
    // third argument instead, and `ingest` is never called at all. The two
    // redacted rows are not even animatable, so they are dropped first.
    expect(sessions.log).toEqual(["snapshot:9+animate:9"]);
  });
});

describe("unmounting while the map is still loading", () => {
  it("never builds a session on a port the cleanup has already closed", async () => {
    mapMode = "deferred";
    const view = render(<OnlineGame gameId="g_1" />);
    await waitFor(() => expect(emitSync).not.toBeNull());

    // The cold body starts the build, which parks on `loadMapForSlug`.
    await act(async () => {
      emitSync?.(coldBody());
    });
    await waitFor(() => expect(releaseMap).not.toBeNull());

    view.unmount();
    expect(closed.count).toBe(1);

    // The map arrives after the port is closed. Nothing may come of it.
    await act(async () => {
      releaseMap?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sessions.count).toBe(0);
  });

  it("builds exactly one session when the map arrives before the unmount", async () => {
    mapMode = "deferred";
    render(<OnlineGame gameId="g_1" />);
    await waitFor(() => expect(emitSync).not.toBeNull());
    await act(async () => {
      emitSync?.(coldBody());
    });
    await waitFor(() => expect(releaseMap).not.toBeNull());

    await act(async () => {
      releaseMap?.();
    });
    await waitFor(() => expect(sessions.count).toBe(1));
    // The `onSnapshot` route into `startIfReady` must not build a second one.
    await act(async () => {
      emitSnapshot?.(snapshot(), 2);
    });
    expect(sessions.count).toBe(1);
  });
});
