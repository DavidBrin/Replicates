import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { IDENTITY_KEY } from "@/adapters/localStorage/identity";
import { routerMock } from "../../vitest.setup";

import HomePage from "./page";

/**
 * This jsdom runs without `--localstorage-file`, so `window.localStorage` is
 * absent and every adapter read falls into its `catch`. The Home screen's
 * whole first-arrival branch turns on that read, so the suite installs a
 * plain in-memory Storage first.
 */
const memory = new Map<string, string>();
const storage: Storage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, String(value)); },
  removeItem: (key) => { memory.delete(key); },
  clear: () => { memory.clear(); },
  key: (index) => [...memory.keys()][index] ?? null,
  get length() { return memory.size; },
};
Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });

beforeEach(() => {
  window.localStorage.clear();
  routerMock.push.mockClear();
  // no S5 route in a unit test: the adapter falls back to a local identity
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

describe("/ (Home)", () => {
  it("paints the ghosted world map, the sunburst, the portrait and the BATTLE pill", () => {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ displayName: "Bold General 42", colour: "blue" }));
    render(<HomePage />);
    expect(screen.getByTestId("home-ghost-map")).toBeInTheDocument();
    expect(screen.getByTestId("home-sunburst")).toBeInTheDocument();
    expect(screen.getByTestId("home-avatar")).toBeInTheDocument();
    expect(screen.getByTestId("home-name")).toHaveTextContent("Bold General 42");
    expect(screen.getByTestId("home-battle")).toHaveTextContent("BATTLE");
  });

  it("has no shop, no news and no rank", () => {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ displayName: "Bold General 42", colour: "red" }));
    render(<HomePage />);
    const text = screen.getByTestId("home-screen").textContent ?? "";
    expect(text).not.toMatch(/shop|news|rank/i);
  });

  it("opens the identity sheet on first arrival and closes it once claimed", async () => {
    render(<HomePage />);
    await waitFor(() => expect(screen.getByTestId("identity-sheet")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("identity-name"), { target: { value: "Iron Marshal 7" } });
    fireEvent.click(screen.getByTestId("identity-continue"));
    await waitFor(() => expect(screen.queryByTestId("identity-sheet")).toBeNull());
    expect(screen.getByTestId("home-name")).toHaveTextContent("Iron Marshal 7");
  });

  it("re-opens the sheet from the settings affordance when an identity is cached", async () => {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ displayName: "Bold General 42", colour: "red" }));
    render(<HomePage />);
    await waitFor(() => expect(screen.queryByTestId("identity-sheet")).toBeNull());
    fireEvent.click(screen.getByTestId("home-settings"));
    expect(screen.getByTestId("identity-sheet")).toBeInTheDocument();
  });

  it("routes to /new from BATTLE", () => {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ displayName: "Bold General 42", colour: "red" }));
    render(<HomePage />);
    fireEvent.click(screen.getByTestId("home-battle"));
    expect(routerMock.push).toHaveBeenCalledWith("/new");
  });
});
