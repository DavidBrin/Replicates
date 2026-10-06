import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { playMapSlugs } from "@/game/pending";
import { DEFAULT_VORONOI, sessionConfigStore } from "@/game/sessionConfig";
import { routerMock } from "../../../../vitest.setup";

import MapPickerPage from "./page";

beforeEach(() => {
  sessionConfigStore.getState().reset();
  routerMock.push.mockClear();
});

describe("/new/map (Map picker)", () => {
  it("lists every slug playMapSlugs() offers, plus the Random map tile, with nothing locked", async () => {
    render(<MapPickerPage />);
    const slugs = playMapSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(screen.getByTestId(`map-tile-${slug}`)).toBeEnabled();
    }
    expect(screen.getByTestId("map-tile-random")).toHaveTextContent("Random map");
    expect(screen.getByTestId("map-picker-screen").textContent).not.toMatch(/locked/i);
    await screen.findAllByTestId("map-tile-board");
  });

  it("writes a slug source when a tile is picked", async () => {
    render(<MapPickerPage />);
    const slug = playMapSlugs()[0] as string;
    fireEvent.click(screen.getByTestId(`map-tile-${slug}`));
    expect(sessionConfigStore.getState().source).toEqual({ kind: "slug", slug });
    await screen.findAllByTestId("map-tile-board");
  });

  it("writes { kind: 'random', options, seed } and keeps the seed while the steppers move", async () => {
    render(<MapPickerPage />);
    fireEvent.click(screen.getByTestId("map-tile-random"));
    const first = sessionConfigStore.getState().source;
    expect(first).toMatchObject({ kind: "random", options: DEFAULT_VORONOI });
    expect(first?.kind === "random" && first.seed.length).toBeTruthy();

    fireEvent.click(screen.getByTestId("random-territories-inc"));
    fireEvent.click(screen.getByTestId("random-continents-dec"));
    const next = sessionConfigStore.getState().source;
    expect(next).toMatchObject({
      kind: "random",
      options: { territories: DEFAULT_VORONOI.territories + 1, continents: DEFAULT_VORONOI.continents - 1 },
    });
    expect(next?.kind === "random" && next.seed).toBe(first?.kind === "random" && first.seed);
    await screen.findAllByTestId("map-tile-board");
  });

  it("clamps the Voronoi steppers to the §4.14 ranges", async () => {
    render(<MapPickerPage />);
    fireEvent.click(screen.getByTestId("map-tile-random"));
    for (let i = 0; i < 10; i += 1) fireEvent.click(screen.getByTestId("random-continents-dec"));
    expect(screen.getByTestId("random-continents-value")).toHaveTextContent("4");
    await screen.findAllByTestId("map-tile-board");
  });

  it("holds Next until a map is chosen, then routes to /new/rules", async () => {
    render(<MapPickerPage />);
    expect(screen.getByTestId("map-next")).toBeDisabled();
    fireEvent.click(screen.getByTestId("map-tile-random"));
    expect(screen.getByTestId("map-next")).toBeEnabled();
    fireEvent.click(screen.getByTestId("map-next"));
    expect(routerMock.push).toHaveBeenCalledWith("/new/rules");
    await screen.findAllByTestId("map-tile-board");
  });
});
