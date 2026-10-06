import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RULES, type Rules } from "@/engine/types";

/**
 * `/lobby/[code]`'s **read-only rule summary** (SPEC §7).
 *
 * The room showed the map, the turn timer and the AI tier and nothing else, so
 * a joiner could not tell Fog of War, Capitals or a 5-Rounds Rumble from a
 * plain game until the board was already dealt — and only the host could see
 * what they had set. The summary is everyone's, and it is read off the poll
 * body's `rules`, so it cannot disagree with the lobby the host actually
 * created.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

let rules: Rules = DEFAULT_RULES;

function installFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/lobby?")) {
        return new Response(JSON.stringify({ you: { playerId: "p1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          version: 1,
          code: "ABCD",
          title: "Alpha's game",
          hostId: "p2",
          status: "open",
          mapSlug: "europe",
          rules,
          maxSeats: 4,
          gameId: null,
          seats: [],
          chat: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
}

let LobbyRoom: typeof import("../LobbyRoom").default;

beforeEach(async () => {
  rules = DEFAULT_RULES;
  installFetch();
  LobbyRoom = (await import("../LobbyRoom")).default;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the lobby room rule summary", () => {
  it("shows the six readout entries from the host's rules", async () => {
    rules = { ...DEFAULT_RULES, turnSeconds: 90, aiDifficulty: "hard", alliances: true };
    render(<LobbyRoom code="ABCD" />);

    await waitFor(() => expect(screen.getByTestId("lobby-rules")).toBeTruthy());
    expect(screen.getByTestId("lobby-rule-turn-timer").textContent).toContain("90s");
    expect(screen.getByTestId("lobby-rule-ai-difficulty").textContent).toContain("Hard");
    expect(screen.getByTestId("lobby-rule-alliances").textContent).toContain("On");
    expect(screen.getByTestId("lobby-rule-setup").textContent).toContain("Auto");
    expect(screen.getByTestId("lobby-rule-card-bonus").textContent).toContain("Fixed");
    expect(screen.getByTestId("lobby-rule-dice-rolls").textContent).toContain("Balanced Blitz");
  });

  it("chips every modifier that is on, and none that is off", async () => {
    rules = {
      ...DEFAULT_RULES,
      fogOfWar: true,
      capitals: true,
      portals: "stable",
      maxRounds: 5,
    };
    render(<LobbyRoom code="ABCD" />);

    await waitFor(() => expect(screen.getByTestId("lobby-rules")).toBeTruthy());
    const chips = screen.getAllByTestId("lobby-rule-modifier").map((node) => node.textContent);
    expect(chips).toEqual(["Fog of War", "Capitals", "Portals: stable", "Max rounds: 5"]);
  });

  it("shows no chips on a plain game", async () => {
    render(<LobbyRoom code="ABCD" />);
    await waitFor(() => expect(screen.getByTestId("lobby-rules")).toBeTruthy());
    expect(screen.queryAllByTestId("lobby-rule-modifier")).toHaveLength(0);
  });

  it("spells out a percentage win condition with its threshold", async () => {
    rules = { ...DEFAULT_RULES, winCondition: "percentage", dominationThreshold: 0.7 };
    render(<LobbyRoom code="ABCD" />);
    await waitFor(() => expect(screen.getByTestId("lobby-rules")).toBeTruthy());
    expect(
      screen.getAllByTestId("lobby-rule-modifier").map((node) => node.textContent),
    ).toEqual(["Domination: 70%"]);
  });

  it("is visible to a joiner, not just the host", async () => {
    render(<LobbyRoom code="ABCD" />);
    await waitFor(() => expect(screen.getByTestId("lobby-rules")).toBeTruthy());
    // `hostId` is `p2` and the viewer is `p1`, so the host-only map picker is
    // absent while the summary is not.
    expect(screen.queryByTestId("lobby-map-picker")).toBeNull();
  });
});
