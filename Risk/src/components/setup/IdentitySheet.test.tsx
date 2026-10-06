import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { NameTakenError, PLAYER_COLOURS } from "@/adapters/localStorage/identity";
import type { Identity, IdentityPort } from "@/ports/identity";

import { IdentitySheet } from "./IdentitySheet";

function port(overrides: Partial<IdentityPort> = {}): IdentityPort {
  return {
    readCached: () => ({ displayName: "Bold General 42", colour: "red" }),
    claim: async (displayName: string): Promise<Identity> => ({ playerId: "p1", displayName, colour: "red" }),
    setColour: async (colour): Promise<Identity> => ({ playerId: "p1", displayName: "Bold General 42", colour }),
    leave: async () => {},
    ...overrides,
  };
}

describe("IdentitySheet", () => {
  it("prefills the generated name and offers nine colour swatches", () => {
    render(<IdentitySheet identity={port()} onDone={() => {}} />);
    expect(screen.getByTestId("identity-sheet")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("identity-name")).toHaveValue("Bold General 42");
    expect(PLAYER_COLOURS).toHaveLength(9);
    for (const colour of PLAYER_COLOURS) {
      expect(screen.getByTestId(`identity-colour-${colour}`)).toBeInTheDocument();
    }
  });

  it("generates an `<Adjective> <Noun> <NN>` name when nothing is cached", () => {
    render(<IdentitySheet identity={port({ readCached: () => null })} onDone={() => {}} />);
    expect((screen.getByTestId("identity-name") as HTMLInputElement).value).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
  });

  it("rejects a name outside 2–20 characters", () => {
    render(<IdentitySheet identity={port()} onDone={() => {}} />);
    const input = screen.getByTestId("identity-name");
    fireEvent.change(input, { target: { value: "x" } });
    expect(screen.getByTestId("identity-error")).toBeInTheDocument();
    expect(screen.getByTestId("identity-continue")).toBeDisabled();

    fireEvent.change(input, { target: { value: "xy" } });
    expect(screen.queryByTestId("identity-error")).toBeNull();
    expect(screen.getByTestId("identity-continue")).toBeEnabled();

    fireEvent.change(input, { target: { value: "x".repeat(21) } });
    expect(screen.getByTestId("identity-error")).toBeInTheDocument();
  });

  it("claims through the port and hands the identity back", async () => {
    const onDone = vi.fn();
    const claim = vi.fn(async (displayName: string) => ({ playerId: "p9", displayName, colour: "red" as const }));
    render(<IdentitySheet identity={port({ claim })} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("identity-continue"));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(claim).toHaveBeenCalledWith("Bold General 42");
  });

  it("writes the picked colour through setColour", async () => {
    const onDone = vi.fn();
    const setColour = vi.fn(async (colour) => ({ playerId: "p1", displayName: "Bold General 42", colour }));
    render(<IdentitySheet identity={port({ setColour })} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("identity-colour-purple"));
    expect(screen.getByTestId("identity-colour-purple")).toHaveAttribute("data-selected", "true");
    fireEvent.click(screen.getByTestId("identity-continue"));
    await waitFor(() => expect(setColour).toHaveBeenCalledWith("purple"));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ colour: "purple" }));
  });

  it("shows the 409's three suggestions inline as clickable chips", async () => {
    const claim = vi.fn(async () => {
      throw new NameTakenError(["Bold General 43", "Iron Marshal 17", "Swift Corsair 88"]);
    });
    render(<IdentitySheet identity={port({ claim })} onDone={() => {}} />);
    fireEvent.click(screen.getByTestId("identity-continue"));
    await waitFor(() => expect(screen.getByTestId("identity-suggestions")).toBeInTheDocument());
    expect(screen.getByTestId("identity-suggestions").children).toHaveLength(3);

    fireEvent.click(screen.getByTestId("identity-suggestion-Iron Marshal 17"));
    expect(screen.getByTestId("identity-name")).toHaveValue("Iron Marshal 17");
    expect(screen.queryByTestId("identity-suggestions")).toBeNull();
  });
});
