import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { resetRosterCache, useMatchConfig, type MatchResult } from "@/lib/matchConfig";
import { Results } from "./Results";

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
  });
});
