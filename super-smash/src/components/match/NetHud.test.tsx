import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { NetHud } from "./NetHud";

const STATS = { rttMs: 41.6, inputDelay: 3, rollbacks: 12 };

describe("NetHud", () => {
  it("shows ping, input delay and rollbacks", () => {
    render(<NetHud stats={STATS} health="ok" peerAway={false} />);
    expect(screen.getByText("PING 42 ms · DELAY 3f · ROLLBACKS 12")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says it is waiting when the opponent goes quiet", () => {
    render(<NetHud stats={STATS} health="waiting" peerAway={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for opponent…");
  });

  it("says why when the opponent switched tabs", () => {
    render(<NetHud stats={STATS} health="waiting" peerAway />);
    expect(screen.getByRole("status")).toHaveTextContent("Opponent switched tabs…");
  });

  it("shows nothing numeric before the first stats arrive", () => {
    render(<NetHud stats={null} health="ok" peerAway={false} />);
    expect(screen.queryByText(/PING/)).toBeNull();
  });
});
