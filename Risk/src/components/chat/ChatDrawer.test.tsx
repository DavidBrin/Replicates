import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { ChatLine } from "@/ports/sync";

import { ChatBalloon } from "./ChatBalloon";
import { ChatDrawer } from "./ChatDrawer";
import { ChatLog } from "./ChatLog";

const LINES: readonly ChatLine[] = [
  { id: 1, scope: "game", displayName: "Solace", lineId: 34, emoji: null,
    createdAt: "2026-01-01T00:00:00.000Z" },
  { id: 2, scope: "game", displayName: "Bot 2", lineId: null, emoji: "thumbsUp",
    createdAt: "2026-01-01T00:00:01.000Z" },
];

describe("ChatDrawer", () => {
  it("renders nothing while closed", () => {
    render(<ChatDrawer open={false} me={{ name: "Solace", colour: "red" }} lines={[]} allied
      onSend={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId("chat-drawer")).toBeNull();
  });

  it("stacks the ALL channel pill, the emoji grid, the roster and the log", () => {
    render(<ChatDrawer open me={{ name: "Solace", colour: "red" }} lines={LINES} allied
      onSend={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("chat-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("chat-channel")).toHaveTextContent("ALL");
    expect(screen.getByTestId("emoji-grid")).toBeInTheDocument();
    expect(screen.getByTestId("dialog-roster")).toBeInTheDocument();
    expect(screen.getByTestId("chat-log")).toBeInTheDocument();
  });

  it("forwards both a glyph and a roster line through one onSend", () => {
    const onSend = vi.fn();
    render(<ChatDrawer open me={{ name: "Solace", colour: "red" }} lines={[]} allied
      onSend={onSend} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("emoji-grin"));
    expect(onSend).toHaveBeenCalledWith({ emoji: "grin" });
    fireEvent.click(screen.getByTestId("dialog-line-1"));
    expect(onSend).toHaveBeenLastCalledWith({ lineId: 1 });
  });

  it("hides the two ally-only lines when no alliance is active", () => {
    render(<ChatDrawer open me={{ name: "Solace", colour: "red" }} lines={[]} allied={false}
      onSend={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId("dialog-line-28")).toBeNull();
  });
});

describe("ChatLog", () => {
  it("renders a line as `displayName: text`", () => {
    render(<ChatLog lines={LINES} />);
    expect(screen.getByTestId("chat-line-1")).toHaveTextContent("Solace: Great game.");
  });

  it("resolves a glyph line to its label", () => {
    render(<ChatLog lines={LINES} />);
    expect(screen.getByTestId("chat-line-2")).toHaveTextContent("Bot 2: Thumbs up");
  });

  it("renders a system notice as plain light text in the same column", () => {
    const notice = "The host has deactivated alliances for this game. No private chat allowed.";
    render(<ChatLog lines={LINES} notices={[notice]} />);
    const notices = screen.getAllByTestId("chat-notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent(notice);
    expect(notices[0]?.tagName).toBe("P");
  });
});

describe("ChatBalloon", () => {
  it("shows the line text and is purely presentational", () => {
    render(<ChatBalloon text="NO DICE!" colour="red" />);
    const balloon = screen.getByTestId("chat-balloon");
    expect(balloon).toHaveTextContent("NO DICE!");
    expect(balloon).toHaveAttribute("role", "status");
  });

  it("reports only its own exit animation to onDone", () => {
    const onDone = vi.fn();
    render(<ChatBalloon text="GG!" colour="blue" onDone={onDone} />);
    // The pop-in lives on the outer balloon; finishing it must not dismiss.
    fireEvent.animationEnd(screen.getByTestId("chat-balloon"), { bubbles: true });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.animationEnd(screen.getByTestId("chat-balloon-fade"), { bubbles: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
