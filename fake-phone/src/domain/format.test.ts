import { describe, expect, it } from "vitest";

import {
  formatCallDuration,
  formatCallDurationAndroid,
  formatViewerCount,
  initialsFor,
} from "./format";

describe("formatCallDuration (iOS)", () => {
  it("shows the first tick as 0:01, not 00:01", () => {
    // The single most common tell in a replica call screen.
    expect(formatCallDuration(1)).toBe("0:01");
  });

  it("omits the leading zero on minutes and pads seconds", () => {
    expect(formatCallDuration(0)).toBe("0:00");
    expect(formatCallDuration(7)).toBe("0:07");
    expect(formatCallDuration(83)).toBe("1:23");
    expect(formatCallDuration(585)).toBe("9:45");
    expect(formatCallDuration(3599)).toBe("59:59");
  });

  it("switches to H:MM:SS exactly at one hour", () => {
    expect(formatCallDuration(3600)).toBe("1:00:00");
    expect(formatCallDuration(3723)).toBe("1:02:03");
    expect(formatCallDuration(36000)).toBe("10:00:00");
  });

  it("clamps nonsense rather than throwing on a call screen", () => {
    expect(formatCallDuration(-5)).toBe("0:00");
    expect(formatCallDuration(Number.NaN)).toBe("0:00");
    expect(formatCallDuration(2.9)).toBe("0:02");
  });
});

describe("formatCallDurationAndroid", () => {
  it("keeps two-digit minutes, unlike iOS", () => {
    expect(formatCallDurationAndroid(7)).toBe("00:07");
    expect(formatCallDurationAndroid(83)).toBe("01:23");
    expect(formatCallDurationAndroid(3723)).toBe("1:02:03");
  });
});

describe("formatViewerCount", () => {
  it("is exact below a thousand", () => {
    expect(formatViewerCount(0)).toBe("0");
    expect(formatViewerCount(148)).toBe("148");
    expect(formatViewerCount(999)).toBe("999");
  });

  it("abbreviates thousands to one decimal", () => {
    expect(formatViewerCount(1000)).toBe("1.0K");
    expect(formatViewerCount(1234)).toBe("1.2K");
    expect(formatViewerCount(99_999)).toBe("99.9K");
  });

  it("drops the decimal from a hundred thousand", () => {
    expect(formatViewerCount(100_000)).toBe("100K");
    expect(formatViewerCount(999_999)).toBe("999K");
  });

  it("abbreviates millions", () => {
    expect(formatViewerCount(1_000_000)).toBe("1.0M");
    expect(formatViewerCount(2_450_000)).toBe("2.4M");
  });

  it("truncates rather than rounds, so the counter never jumps backwards", () => {
    // Rounding would show 1.0K at 999 viewers and then visibly drop to 999
    // when one more arrived and the exact branch took over.
    expect(formatViewerCount(1999)).toBe("1.9K");
  });
});

describe("initialsFor", () => {
  it("takes first and last initials", () => {
    expect(initialsFor("Sarah Okonjo")).toBe("SO");
    expect(initialsFor("mum")).toBe("M");
    expect(initialsFor("Ana Maria de Souza")).toBe("AS");
  });

  it("survives an empty or whitespace name", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });

  it("keeps a whole emoji grapheme instead of half a surrogate pair", () => {
    // Saving a contact as "❤️ Mum" is common; splitting the code point would
    // render a replacement character on the call screen.
    expect(initialsFor("❤️ Mum")).toContain("M");
    expect(initialsFor("❤️ Mum")).not.toContain("�");
  });
});
