import { describe, expect, it } from "vitest";

import {
  HEX_COLOR,
  InvalidColorError,
  isHexColor,
  normalizeHexColor,
} from "../color";

/**
 * The defect this file exists for: colour columns were `z.string().max(40)`,
 * and every colour ends up assigned to a CSS property. `url(//host/pixel)` is
 * 21 characters, so it passed, was stored, and then fired from every other
 * member's browser each time the label rendered.
 *
 * The payload cases below are the point of the suite. A test that only checks
 * `#5e6ad2` passes against a schema with no rule at all.
 */
describe("hex colour validation", () => {
  it("accepts a six-digit hex colour in either case", () => {
    expect(isHexColor("#5e6ad2")).toBe(true);
    expect(isHexColor("#5E6AD2")).toBe(true);
  });

  it("normalises case so one colour is one value", () => {
    expect(normalizeHexColor("#5E6AD2")).toBe("#5e6ad2");
    expect(normalizeHexColor("  #5e6ad2  ")).toBe("#5e6ad2");
  });

  describe("rejects CSS that is not a colour", () => {
    // Each of these was storable before the fix. They are kept as a list
    // rather than a single case because they fail through different routes:
    // a function call, a vendor-prefixed one, an escape, and a comment split.
    const payloads = [
      "url(//attacker.example/pixel)",
      "url('//attacker.example/p')",
      "image-set(url(//a.example/x) 1x)",
      "-webkit-image-set(url(//a.example/x) 1x)",
      "#5e6ad2; background-image: url(//a.example/x)",
      "#5e6ad2/**/;background:url(//a.example/x)",
      "\\75 rl(//attacker.example/x)",
      "red",
      "var(--bg-app)",
      "#fff",
      "#5e6ad2aa",
      "5e6ad2",
      "#5e6ad",
      "#5e6adz",
      "",
    ];

    it.each(payloads)("refuses %j", (payload) => {
      expect(isHexColor(payload)).toBe(false);
      expect(() => normalizeHexColor(payload)).toThrow(InvalidColorError);
    });
  });

  it("treats surrounding whitespace as noise, not as payload", () => {
    // The two functions disagree here on purpose, and the disagreement is the
    // safe way round. `isHexColor` is the raw predicate and rejects a trailing
    // newline outright — which is what the API path uses, because Zod's
    // `.regex()` does not trim. `normalizeHexColor` is the storage helper and
    // trims first, so a value pasted with stray whitespace is stored rather
    // than refused. Neither can let a payload through: trimming removes
    // whitespace, and no amount of whitespace makes `url(...)` six hex digits.
    expect(isHexColor("#5e6ad2\n")).toBe(false);
    expect(normalizeHexColor("#5e6ad2\n")).toBe("#5e6ad2");
    expect(() => normalizeHexColor(" url(//a.example/x) ")).toThrow(
      InvalidColorError,
    );
  });

  it("does not echo the offending value back into an error message", () => {
    // The value is attacker-chosen text; a message that repeats it hands the
    // payload to whatever renders the error.
    const payload = "url(//attacker.example/pixel)";
    try {
      normalizeHexColor(payload);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidColorError);
      expect((error as Error).message).not.toContain("attacker.example");
      expect((error as InvalidColorError).value).toBe(payload);
    }
  });

  it("is anchored at both ends", () => {
    // A regex missing `^` or `$` matches a valid colour *inside* a payload,
    // which is precisely how a whitelist silently becomes a blacklist.
    expect(HEX_COLOR.source.startsWith("^")).toBe(true);
    expect(HEX_COLOR.source.endsWith("$")).toBe(true);
    expect(HEX_COLOR.flags).not.toContain("m");
  });
});
