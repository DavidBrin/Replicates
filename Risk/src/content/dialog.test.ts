/** The 42-line roster and the eight emoji (SPEC §7.3, D41). */
import { describe, expect, it } from "vitest";

import {
  BOT_REACTIONS, DIALOG_GROUPS, DIALOG_LINES, EMOJI, EMOJI_MORE, dialogLine, dialogText, linesByGroup,
} from "./dialog";

describe("the dialog roster", () => {
  it("has exactly 42 lines", () => {
    expect(DIALOG_LINES).toHaveLength(42);
  });

  it("numbers them 1..42 with no gaps", () => {
    expect(DIALOG_LINES.map((l) => l.id)).toEqual(Array.from({ length: 42 }, (_, i) => i + 1));
  });

  it("groups them exactly as published", () => {
    expect(DIALOG_GROUPS.map((g) => g.id)).toEqual([
      "greetings", "diplomacy", "threats", "reactions", "apologies", "encouragement", "endgame",
    ]);
    const sizes = linesByGroup().map((g) => g.lines.length);
    expect(sizes).toEqual([5, 7, 7, 8, 5, 5, 5]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(42);
  });

  it("keeps every group contiguous in roster order", () => {
    const order = linesByGroup().flatMap((g) => g.lines.map((l) => l.id));
    expect(order).toEqual(DIALOG_LINES.map((l) => l.id));
  });

  it("marks exactly lines 28 and 29 ally-only", () => {
    expect(DIALOG_LINES.filter((l) => l.allyOnly).map((l) => l.id)).toEqual([28, 29]);
  });

  it("marks exactly the five RGD-verbatim lines", () => {
    expect(DIALOG_LINES.filter((l) => l.verbatim).map((l) => l.id)).toEqual([20, 21, 28, 29, 34]);
  });

  it("reproduces the five verbatim lines word for word", () => {
    expect(dialogText(20)).toBe("NO DICE!");
    expect(dialogText(21)).toBe("THE DICE HATE ME!");
    expect(dialogText(28)).toBe("Sorry, I need to attack your territory.");
    expect(dialogText(29)).toBe("Attack my territory if you need to.");
    expect(dialogText(34)).toBe("Great game.");
  });

  it("reproduces the group openers verbatim", () => {
    expect(dialogText(1)).toBe("Hello!");
    expect(dialogText(6)).toBe("Truce?");
    expect(dialogText(13)).toBe("Your territory looks... undefended.");
    expect(dialogText(30)).toBe("My bad.");
    expect(dialogText(33)).toBe("Thanks!");
    expect(dialogText(38)).toBe("GG!");
    expect(dialogText(42)).toBe("Good game, see you next time.");
  });

  it("has no duplicate text", () => {
    expect(new Set(DIALOG_LINES.map((l) => l.text)).size).toBe(42);
  });

  it("offers 40 lines when no alliance is active", () => {
    expect(DIALOG_LINES.filter((l) => !l.allyOnly)).toHaveLength(40);
  });

  it("looks a line up by id and misses cleanly", () => {
    expect(dialogLine(7)?.text).toBe("Alliance? Let's team up.");
    expect(dialogLine(99)).toBeUndefined();
    expect(dialogText(99)).toBe("");
  });
});

describe("the emoji set", () => {
  it("is eight code-drawn glyphs plus the ninth slot", () => {
    expect(EMOJI).toHaveLength(8);
    expect(EMOJI_MORE).toBe("…");
  });

  it("gives every glyph a unique id and a label", () => {
    expect(new Set(EMOJI.map((e) => e.id)).size).toBe(8);
    for (const e of EMOJI) expect(e.label.length).toBeGreaterThan(0);
  });
});

describe("bot reactions (D42, ours)", () => {
  it("draws only from the published roster", () => {
    const ids = new Set(DIALOG_LINES.map((l) => l.id));
    for (const pool of Object.values(BOT_REACTIONS)) {
      expect(pool.length).toBeGreaterThan(0);
      for (const id of pool) expect(ids.has(id)).toBe(true);
    }
  });

  it("never offers an ally-only line as a bot reaction", () => {
    const allyOnly = new Set(DIALOG_LINES.filter((l) => l.allyOnly).map((l) => l.id));
    for (const pool of Object.values(BOT_REACTIONS)) {
      for (const id of pool) expect(allyOnly.has(id)).toBe(false);
    }
  });
});
