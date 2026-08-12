import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { resetRosterCache, useMatchConfig } from "@/lib/matchConfig";
import { StageSelect } from "./StageSelect";

async function renderStages() {
  render(<StageSelect />);
  await act(async () => {});
}

const formButton = () => screen.getByRole("button", { name: /^form:/i });

beforeEach(() => {
  useMatchConfig.getState().reset();
  resetRosterCache();
  routerMock.push.mockClear();
});

describe("StageSelect", () => {
  it("lists the six legal stages and a random slot", async () => {
    await renderStages();

    expect(screen.getByRole("button", { name: "Battlefield" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();
  });

  /**
   * The real game cycles the form on press rather than opening a picker, so
   * this is the behaviour to hold onto: three presses return you to where you
   * started.
   */
  it("cycles Normal → Battlefield → Ω → Normal on press", async () => {
    await renderStages();

    expect(formButton()).toHaveAccessibleName(/normal/i);

    fireEvent.click(formButton());
    expect(useMatchConfig.getState().stageForm).toBe("battlefield");
    expect(formButton()).toHaveAccessibleName(/battlefield/i);

    fireEvent.click(formButton());
    expect(useMatchConfig.getState().stageForm).toBe("omega");
    expect(formButton()).toHaveAccessibleName(/Ω/);

    fireEvent.click(formButton());
    expect(useMatchConfig.getState().stageForm).toBe("normal");
    expect(formButton()).toHaveAccessibleName(/normal/i);
  });

  it("selects a stage and reports it in the preview", async () => {
    await renderStages();

    fireEvent.click(screen.getByRole("button", { name: "Smashville" }));

    expect(useMatchConfig.getState().stageId).toBe("smashville");
    expect(screen.getByRole("heading", { name: /smashville/i })).toBeInTheDocument();
  });

  /** Ω is flat by definition — a stage with soft platforms must lose them. */
  it("reports no soft platforms once the form is Ω", async () => {
    await renderStages();

    fireEvent.click(screen.getByRole("button", { name: "Battlefield" }));
    expect(screen.getByText("Platforms").nextElementSibling).toHaveTextContent("3");

    fireEvent.click(formButton());
    fireEvent.click(formButton());
    expect(useMatchConfig.getState().stageForm).toBe("omega");
    expect(screen.getByText("Platforms").nextElementSibling).toHaveTextContent("0");
  });

  it("continues to the character select", async () => {
    await renderStages();

    fireEvent.click(screen.getByRole("button", { name: /choose fighters/i }));

    expect(routerMock.push).toHaveBeenCalledWith("/fighters");
  });
});
