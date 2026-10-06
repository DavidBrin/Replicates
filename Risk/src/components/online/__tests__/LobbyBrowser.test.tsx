import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RULES, TURN_SECONDS, type SeatConfig } from "@/engine/types";
import { sessionConfigStore } from "@/game/sessionConfig";

/**
 * `/lobby`'s `Create` (SPEC §7, §5.1, §6).
 *
 * `/lobby` is the **end of the Online setup flow**, not a separate entrance:
 * `/new` writes `mode: "online"`, `/new/map` writes the `MapSource`,
 * `/new/rules` writes the `Rules` and the seat rows, and green BATTLE sets
 * `ready` and routes here. `Create` used to post a hard-coded
 * `classic-world`, `DEFAULT_RULES` and six seats, so every one of those
 * choices was thrown away between the two screens.
 */

const pushed: string[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

const calls: Call[] = [];

/**
 * POLL 1 answers once with an identity so the browser renders its shell;
 * `POST /api/lobbies` answers `201 { code }`, and the `PATCH` that fills the
 * bot seats answers `200`.
 */
function installFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      calls.push({ url, method, body });

      if (method === "GET" && url.startsWith("/api/lobby")) {
        return new Response(
          JSON.stringify({
            version: 1,
            players: [],
            lobbies: [],
            chat: [],
            you: { playerId: "p1", displayName: "Alpha", colour: "red" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (method === "POST" && url === "/api/lobbies") {
        return new Response(JSON.stringify({ code: "ABCD" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function seat(kind: SeatConfig["kind"], tier: SeatConfig["tier"] = null): SeatConfig {
  return { kind, name: kind, colour: "red", tier };
}

let LobbyBrowser: typeof import("../LobbyBrowser").default;
let lobbyChoice: typeof import("../LobbyBrowser").lobbyChoice;

beforeEach(async () => {
  calls.length = 0;
  pushed.length = 0;
  sessionConfigStore.getState().reset();
  installFetch();
  const loaded = await import("../LobbyBrowser");
  LobbyBrowser = loaded.default;
  lobbyChoice = loaded.lobbyChoice;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sessionConfigStore.getState().reset();
});

/* ------------------------------------------------------- the pure choice -- */

describe("lobbyChoice", () => {
  it("falls back to the defaults when nothing was chosen", () => {
    const choice = lobbyChoice(sessionConfigStore.getState());
    expect(choice.mapSlug).toBe("classic-world");
    expect(choice.maxSeats).toBe(6);
    expect(choice.rules.turnSeconds).toBe(TURN_SECONDS[1]);
    expect(choice.bots).toEqual([]);
  });

  it("falls back to the defaults when the player did not come through BATTLE", () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setSource({ kind: "slug", slug: "europe" });
    // `ready` is what BATTLE sets; without it the store is a half-filled form.
    const choice = lobbyChoice(sessionConfigStore.getState());
    expect(choice.mapSlug).toBe("classic-world");
  });

  it("takes the map, the rules and the seat count the player chose", () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setSource({ kind: "slug", slug: "europe" });
    store.setRules({ fogOfWar: true, capitals: true, aiDifficulty: "hard" });
    store.setSeatCount(4);
    store.setReady(true);

    const choice = lobbyChoice(sessionConfigStore.getState());
    expect(choice.mapSlug).toBe("europe");
    expect(choice.rules.fogOfWar).toBe(true);
    expect(choice.rules.capitals).toBe(true);
    expect(choice.rules.aiDifficulty).toBe("hard");
    expect(choice.maxSeats).toBe(4);
  });

  it("turns the bot seat rows into bot seats, never seat 0", () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setSource({ kind: "slug", slug: "europe" });
    store.setReady(true);
    sessionConfigStore.setState({
      seats: [seat("human"), seat("bot", "easy"), seat("human"), seat("bot", "expert")],
    });

    expect(lobbyChoice(sessionConfigStore.getState()).bots).toEqual([
      { seat: 1, tier: "easy" },
      { seat: 3, tier: "expert" },
    ]);
  });

  it("drops a bot row at seat 0, which is always the host", () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setReady(true);
    sessionConfigStore.setState({ seats: [seat("bot", "easy"), seat("human")] });
    expect(lobbyChoice(sessionConfigStore.getState()).bots).toEqual([]);
  });

  it("refuses a generated map: the authority can only load a slug", () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setSource({
      kind: "random",
      options: { territories: 42, continents: 6, width: 1600, height: 900, seaLinks: 7 },
      seed: "s",
    });
    store.setReady(true);
    expect(lobbyChoice(sessionConfigStore.getState()).mapSlug).toBe("classic-world");
  });

  it("refuses a fixture slug, which is never in a picker (D39)", () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setSource({ kind: "slug", slug: "tiny4" });
    store.setReady(true);
    expect(lobbyChoice(sessionConfigStore.getState()).mapSlug).toBe("classic-world");
  });

  it("always gives an online lobby a turn timer (R79)", () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setRules({ turnSeconds: null });
    store.setReady(true);
    expect(lobbyChoice(sessionConfigStore.getState()).rules.turnSeconds).toBe(TURN_SECONDS[1]);
    expect(DEFAULT_RULES.turnSeconds).toBeNull();
  });

  it("keeps a turn timer the player set", () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setRules({ turnSeconds: TURN_SECONDS[4] });
    store.setReady(true);
    expect(lobbyChoice(sessionConfigStore.getState()).rules.turnSeconds).toBe(TURN_SECONDS[4]);
  });
});

/* ------------------------------------------------------------ the request -- */

describe("Create", () => {
  it("posts the map, rules and seat count from the store, then fills the bots", async () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setSource({ kind: "slug", slug: "europe" });
    store.setRules({ fogOfWar: true });
    store.setReady(true);
    sessionConfigStore.setState({
      seats: [seat("human"), seat("bot", "hard"), seat("human")],
    });

    render(<LobbyBrowser />);
    await waitFor(() => expect(screen.getByTestId("lobby-create")).toBeTruthy());

    await act(async () => {
      screen.getByTestId("lobby-create").click();
    });
    await waitFor(() => expect(pushed).toContain("/lobby/ABCD"));

    const post = calls.find((call) => call.method === "POST" && call.url === "/api/lobbies");
    expect(post?.body.mapSlug).toBe("europe");
    expect(post?.body.maxSeats).toBe(3);
    expect((post?.body.rules as { fogOfWar: boolean }).fogOfWar).toBe(true);

    // `POST /api/lobbies` has no seat argument, so the bot rows ride the same
    // host-only `PATCH` the room's own "Add a bot…" uses.
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toBe("/api/lobbies/ABCD");
    expect(patch?.body.seats).toEqual([{ seat: 1, kind: "bot", tier: "hard" }]);
  });

  it("sends no PATCH when the player chose no bots", async () => {
    const store = sessionConfigStore.getState();
    store.setMode("online");
    store.setReady(true);
    sessionConfigStore.setState({ seats: [seat("human"), seat("human")] });

    render(<LobbyBrowser />);
    await waitFor(() => expect(screen.getByTestId("lobby-create")).toBeTruthy());
    await act(async () => {
      screen.getByTestId("lobby-create").click();
    });
    await waitFor(() => expect(pushed).toContain("/lobby/ABCD"));

    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });
});
