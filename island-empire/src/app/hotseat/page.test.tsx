import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateRandomMap } from "@/engine";
import type { MapDefinition } from "@/engine/types";
import { useSessionConfig } from "@/game/sessionConfig";

import { routerMock } from "../../../vitest.setup";
import HotSeatSetupPage from "./page";

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
    { index: 1, colour: "red", kind: "human", startGold: 10 },
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

describe("HotSeatSetupPage", () => {
  it("defaults every seat to human, 2 seats, each with an editable colour-name field", () => {
    render(<HotSeatSetupPage />);
    expect(screen.getByTestId("seat-count")).toHaveTextContent("2");
    expect(screen.getByTestId("seat-1-kind")).toHaveTextContent("Human");
    expect(screen.getByTestId("seat-1-name")).toHaveValue("Blue");
    expect(screen.getByTestId("seat-2-name")).toHaveValue("Red");
  });

  it("renaming a seat carries the new name into the built SessionConfig", async () => {
    const user = userEvent.setup();
    render(<HotSeatSetupPage />);

    await waitFor(() => expect(generateRandomMap).toHaveBeenCalled());

    const nameInput = screen.getByTestId("seat-1-name");
    await user.clear(nameInput);
    await user.type(nameInput, "David");

    await user.click(screen.getByTestId("play"));

    const config = useSessionConfig.getState().config;
    expect(config?.seats[0]).toMatchObject({ index: 0, kind: "human", name: "David" });
    expect(config?.difficulty).toBe("normal");
    expect(routerMock.push).toHaveBeenCalledWith("/play/session");
  });

  it("toggling a seat to AI swaps the name field for a difficulty select", async () => {
    const user = userEvent.setup();
    render(<HotSeatSetupPage />);

    await user.click(screen.getByTestId("seat-2-kind"));

    expect(screen.queryByTestId("seat-2-name")).not.toBeInTheDocument();
    expect(screen.getByTestId("seat-2-difficulty")).toBeInTheDocument();
    expect(screen.getByTestId("seat-2-kind")).toHaveTextContent("AI");
  });

  it("adding a seat past the default 2 gives it a fresh colour name", async () => {
    const user = userEvent.setup();
    render(<HotSeatSetupPage />);

    await user.click(screen.getByTestId("seat-count-increase"));

    expect(screen.getByTestId("seat-count")).toHaveTextContent("3");
    expect(screen.getByTestId("seat-3-name")).toHaveValue("Green");
  });
});
