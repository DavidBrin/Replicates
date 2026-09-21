import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { localProgress } from "@/adapters/localStorage/progress";
import { useSessionConfig } from "@/game/sessionConfig";
import { routerMock } from "../../../vitest.setup";

import { installMemoryLocalStorage } from "@/components/ui/localStorage.test-support";

import { LevelIntro } from "./LevelIntro";

installMemoryLocalStorage();

describe("LevelIntro", () => {
  beforeEach(() => {
    window.localStorage.clear();
    localProgress.reset();
    useSessionConfig.getState().clear();
    routerMock.push.mockClear();
  });

  it("renders the level's name, size, players and stars from progress", async () => {
    localProgress.recordLevelWin("02", "easy", 7);
    localProgress.recordLevelWin("03", "easy", 9);
    localProgress.recordLevelWin("03", "hard", 12);

    render(<LevelIntro levelId="03" />);

    expect(screen.getByRole("heading", { name: "The Wall" })).toBeInTheDocument();
    expect(screen.getByTestId("intro-size")).toHaveTextContent("10×12");
    expect(screen.getByTestId("intro-players")).toHaveTextContent("2");
    expect(screen.getByText("Level: 3")).toBeInTheDocument();

    // Stars arrive after the client-side progress read.
    await waitFor(() => expect(screen.getByTestId("star-row")).toHaveAttribute("data-stars", "2"));
    expect(screen.getByTestId("difficulty-easy")).toHaveAttribute("data-won", "true");
    expect(screen.getByTestId("difficulty-normal")).toHaveAttribute("data-won", "false");
    expect(screen.getByTestId("difficulty-hard")).toHaveAttribute("data-won", "true");
    // The picker defaults to the first unbeaten difficulty.
    expect(screen.getByTestId("difficulty-normal")).toHaveAttribute("aria-checked", "true");

    // The minimap loads the level definition.
    await waitFor(() => expect(screen.getByTestId("minimap")).toBeInTheDocument());
  });

  it("Start writes the session config for the chosen difficulty and routes to the play screen", async () => {
    localProgress.recordLevelWin("01", "easy", 5);
    render(<LevelIntro levelId="02" seed={4242} />);

    const start = await screen.findByTestId("start-level");
    await waitFor(() => expect(start).toBeEnabled());
    await userEvent.click(screen.getByTestId("difficulty-hard"));
    await userEvent.click(start);

    const config = useSessionConfig.getState().config;
    expect(config).toEqual({
      source: { kind: "campaign", levelId: "02" },
      seats: [
        { index: 0, kind: "human", aiDifficulty: "hard" },
        { index: 1, kind: "ai", aiDifficulty: "hard" },
      ],
      difficulty: "hard",
      seed: 4242,
    });
    expect(routerMock.push).toHaveBeenCalledWith("/play/campaign/02");
  });

  it("a locked level cannot be started", async () => {
    render(<LevelIntro levelId="05" />);
    const start = await screen.findByTestId("start-level");
    await waitFor(() => expect(start).toBeDisabled());
    expect(start).toHaveTextContent("Locked");
    expect(screen.getByText(/Win the previous level first/i)).toBeInTheDocument();
    expect(useSessionConfig.getState().config).toBeNull();
  });

  it("level 01 is always startable and seats every player of the map", async () => {
    render(<LevelIntro levelId="01" seed={1} />);
    const start = await screen.findByTestId("start-level");
    await waitFor(() => expect(start).toBeEnabled());
    await userEvent.click(start);
    expect(useSessionConfig.getState().config?.seats).toHaveLength(2);
    expect(useSessionConfig.getState().config?.difficulty).toBe("easy");
  });
});
