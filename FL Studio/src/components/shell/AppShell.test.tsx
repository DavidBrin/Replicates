import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

function pressGlobal(code: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { code, ...init });
}

import { AppShell } from "./AppShell";
import { __resetKeyboardRegistryForTests } from "@/lib/keyboard";
import { __resetWiringForTests } from "@/components/shell/wiring";

afterEach(() => {
  __resetKeyboardRegistryForTests();
  __resetWiringForTests();
});

describe("AppShell", () => {
  it("renders all four docked windows by default", () => {
    render(<AppShell />);
    expect(screen.getByText("Playlist")).toBeInTheDocument();
    expect(screen.getByText("Channel rack")).toBeInTheDocument();
    expect(screen.getByText("Mixer - return to new")).toBeInTheDocument();
  });

  it("F5 collapses and restores the Playlist window", () => {
    render(<AppShell />);
    expect(screen.getByText("Playlist")).toBeInTheDocument();

    pressGlobal("F5");
    expect(screen.queryByText("Playlist")).not.toBeInTheDocument();

    pressGlobal("F5");
    expect(screen.getByText("Playlist")).toBeInTheDocument();
  });

  it("F9 collapses and restores the Mixer window", () => {
    render(<AppShell />);
    expect(screen.getByText("Mixer - return to new")).toBeInTheDocument();

    pressGlobal("F9");
    expect(screen.queryByText("Mixer - return to new")).not.toBeInTheDocument();

    pressGlobal("F9");
    expect(screen.getByText("Mixer - return to new")).toBeInTheDocument();
  });

  it("F6/F7 switch the Channel Rack / Piano Roll tabbed region", () => {
    render(<AppShell />);
    expect(screen.getByText("Channel rack")).toBeInTheDocument();

    pressGlobal("F7");
    expect(screen.getByText("Piano roll - Untitled")).toBeInTheDocument();
    expect(screen.queryByText("Channel rack")).not.toBeInTheDocument();

    pressGlobal("F6");
    expect(screen.getByText("Channel rack")).toBeInTheDocument();
  });

  it("Space toggles play/stop via the global binding", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getByLabelText("Play")).toBeInTheDocument();

    await user.keyboard(" ");

    expect(await screen.findByLabelText("Stop")).toBeInTheDocument();
  });

  it("L toggles pattern/song mode via the global binding", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    const modeSwitch = screen.getByLabelText("Toggle pattern / song mode");
    expect(modeSwitch).toHaveTextContent("PAT");

    await user.keyboard("l");

    expect(modeSwitch).toHaveTextContent("SONG");
  });
});
