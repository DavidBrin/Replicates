import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateRandomMap } from "@/engine";
import type { MapDefinition } from "@/engine/types";
import { useSessionConfig } from "@/game/sessionConfig";

import { routerMock } from "../../../vitest.setup";
import RandomMapSetupPage from "./page";

const STUB_MAP: MapDefinition = {
  id: null,
  name: "generated",
  author: "engine",
  width: 2,
  height: 2,
  biome: "grass",
  tiles: [
    { terrain: "grass", owner: 0, building: "city", unit: { level: 1 }, decoration: null, road: false },
    { terrain: "grass", owner: 0, building: null, unit: null, decoration: null, road: false },
    { terrain: "grass", owner: 1, building: "city", unit: { level: 1 }, decoration: null, road: false },
    { terrain: "grass", owner: 1, building: null, unit: null, decoration: null, road: false },
  ],
  players: [
    { index: 0, colour: "blue", kind: "human", startGold: 10 },
    { index: 1, colour: "red", kind: "ai", startGold: 10 },
    { index: 2, colour: "green", kind: "ai", startGold: 10 },
    { index: 3, colour: "yellow", kind: "ai", startGold: 10 },
  ],
  tutorial: [],
  difficulty: null,
};

vi.mock("@/engine", () => ({
  generateRandomMap: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateRandomMap).mockReturnValue(STUB_MAP);
  useSessionConfig.getState().clear();
  routerMock.push.mockClear();
});

describe("RandomMapSetupPage", () => {
  it("defaults seat 1 to human and the rest to AI, 4 seats total", () => {
    render(<RandomMapSetupPage />);
    expect(screen.getByTestId("seat-count")).toHaveTextContent("4");
    expect(screen.getByTestId("seat-1-kind")).toHaveTextContent("Human");
    expect(screen.getByTestId("seat-2-kind")).toHaveTextContent("AI");
    expect(screen.getByTestId("seat-2-difficulty")).toBeInTheDocument();
  });

  it("shows a friendly message instead of crashing when the generator throws", async () => {
    vi.mocked(generateRandomMap).mockImplementation(() => {
      throw new Error("engine: generateRandomMap is not implemented yet");
    });

    render(<RandomMapSetupPage />);

    await waitFor(() => expect(screen.getByTestId("generator-status")).toBeInTheDocument());
  });

  it("clamps the seat count to [2, 8] and keeps kind toggles working", async () => {
    const user = userEvent.setup();
    render(<RandomMapSetupPage />);

    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByTestId("seat-count-decrease"));
    }
    expect(screen.getByTestId("seat-count")).toHaveTextContent("2");

    await user.click(screen.getByTestId("seat-2-kind"));
    expect(screen.getByTestId("seat-2-kind")).toHaveTextContent("Human");
  });

  it("Play builds a generated SessionConfig using the highest AI difficulty and navigates", async () => {
    const user = userEvent.setup();
    render(<RandomMapSetupPage />);

    await waitFor(() => expect(generateRandomMap).toHaveBeenCalled());

    await user.selectOptions(screen.getByTestId("seat-2-difficulty"), "hard");
    await user.click(screen.getByTestId("play"));

    const config = useSessionConfig.getState().config;
    expect(config?.source).toEqual({ kind: "generated", map: STUB_MAP, seed: 424242 });
    expect(config?.difficulty).toBe("hard");
    expect(config?.seats[0]).toMatchObject({ index: 0, kind: "human" });
    expect(routerMock.push).toHaveBeenCalledWith("/play/session");
  });
});
