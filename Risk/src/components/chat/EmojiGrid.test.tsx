import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { EMOJI, EMOJI_MORE } from "@/content/dialog";

import { EmojiGrid } from "./EmojiGrid";

describe("EmojiGrid", () => {
  it("renders the eight code-drawn glyphs plus the ninth … slot", () => {
    render(<EmojiGrid onSend={vi.fn()} onMore={vi.fn()} />);
    const grid = screen.getByTestId("emoji-grid");
    expect(grid.querySelectorAll("button")).toHaveLength(9);
    for (const glyph of EMOJI) expect(screen.getByTestId(`emoji-${glyph.id}`)).toBeInTheDocument();
    expect(screen.getByTestId("emoji-more")).toHaveTextContent(EMOJI_MORE);
  });

  it("labels every tile from EmojiGlyph.label", () => {
    render(<EmojiGrid onSend={vi.fn()} onMore={vi.fn()} />);
    for (const glyph of EMOJI) {
      expect(screen.getByTestId(`emoji-${glyph.id}`)).toHaveAttribute("aria-label", glyph.label);
    }
  });

  it("draws each glyph as inline SVG, never a system emoji character", () => {
    render(<EmojiGrid onSend={vi.fn()} onMore={vi.fn()} />);
    for (const glyph of EMOJI) {
      const tile = screen.getByTestId(`emoji-${glyph.id}`);
      expect(tile.querySelector("svg")).not.toBeNull();
      expect(tile.textContent).toBe("");
    }
  });

  it("sends { emoji: id }", () => {
    const onSend = vi.fn();
    render(<EmojiGrid onSend={onSend} onMore={vi.fn()} />);
    fireEvent.click(screen.getByTestId("emoji-thumbsUp"));
    expect(onSend).toHaveBeenCalledWith({ emoji: "thumbsUp" });
    fireEvent.click(screen.getByTestId("emoji-flag"));
    expect(onSend).toHaveBeenLastCalledWith({ emoji: "flag" });
  });

  it("asks for the roster from the ninth slot instead of sending", () => {
    const onSend = vi.fn();
    const onMore = vi.fn();
    render(<EmojiGrid onSend={onSend} onMore={onMore} />);
    fireEvent.click(screen.getByTestId("emoji-more"));
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});
