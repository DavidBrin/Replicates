import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithSettings } from "@/components/settings/settings-test-harness";

import { routerMock } from "../../../vitest.setup";
import { HomeScreen } from "./home-screen";

describe("HomeScreen", () => {
  beforeEach(() => {
    routerMock.push.mockClear();
  });

  it("carries the wordmark and the slogan", () => {
    renderWithSettings(<HomeScreen />);

    expect(screen.getByTestId("home-screen")).toBeInTheDocument();
    expect(screen.getByText("fake-phone")).toBeVisible();
    expect(screen.getByRole("heading", { name: "never feel alone" })).toBeVisible();
  });

  it("starts a call in one tap", async () => {
    // The one product rule everything else serves: configuration happens in
    // advance, activation is a single tap on the biggest thing on screen
    // (research/competitive-teardown.md §4 Q1/Q2).
    const { user } = renderWithSettings(<HomeScreen />);

    await user.click(screen.getByTestId("start-call"));

    expect(routerMock.push).toHaveBeenCalledWith("/");
  });

  it("goes live in one tap", async () => {
    const { user } = renderWithSettings(<HomeScreen />);

    await user.click(screen.getByTestId("go-live"));

    expect(routerMock.push).toHaveBeenCalledWith("/live");
  });

  it("puts the primary action below the configuration", () => {
    // A layout assertion jsdom can actually make: the action dock comes after
    // the (scrollable) settings in document order, which is what puts it in the
    // lower third of the frame and inside one-handed thumb reach.
    renderWithSettings(<HomeScreen />);

    const panel = screen.getByTestId("settings-panel");
    const start = screen.getByTestId("start-call");

    expect(panel.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ...and it is not inside the scrolling region, so it cannot scroll away.
    expect(panel.contains(start)).toBe(false);
  });

  it("describes itself in safety terms and never as a prank", () => {
    // A compliance constraint, not a preference: App Store Guideline 1.1.6 bans
    // prank-call apps outright and refuses "for entertainment purposes" as a
    // defence, and Google Play's Deceptive Behavior policy matches it
    // (research/competitive-teardown.md §4 Q5). This test is the tripwire.
    renderWithSettings(<HomeScreen />);

    const copy = screen.getByTestId("home-screen").textContent ?? "";

    for (const banned of ["prank", "joke", "trick", "fool"]) {
      expect(copy.toLowerCase()).not.toContain(banned);
    }
    // ...and it must not imply emergency services either (SPEC §1.2).
    for (const banned of ["911", "999", "112", "police", "emergency"]) {
      expect(copy.toLowerCase()).not.toContain(banned);
    }

    expect(copy).toMatch(/staged incoming call/i);
  });

  it("renders the settings surface inline, with no second navigation step", () => {
    // Ending the call is the only way in here, so this screen has to be the
    // whole of options — a menu inside a menu is another step under stress.
    renderWithSettings(<HomeScreen />);

    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
    expect(screen.getByTestId("setting-caller-name")).toBeVisible();
    expect(screen.getByTestId("setting-reset")).toBeVisible();
  });
});
