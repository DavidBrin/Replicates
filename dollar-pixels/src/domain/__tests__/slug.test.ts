import { describe, expect, it } from "vitest";
import {
  RESERVED_SLUGS,
  SLUG_MAX,
  handleFrom,
  isValidSlug,
  slugify,
  validateSlug,
} from "@/domain/slug";

describe("slugs", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(validateSlug("harbour-lights")).toBeNull();
    expect(validateSlug("a1b")).toBeNull();
    expect(isValidSlug("x".repeat(SLUG_MAX))).toBe(true);
  });

  it("rejects the shapes that would produce an ugly or ambiguous URL", () => {
    expect(validateSlug("ab")).toBe("too-short");
    expect(validateSlug("x".repeat(SLUG_MAX + 1))).toBe("too-long");
    expect(validateSlug("Harbour")).toBe("bad-characters");
    expect(validateSlug("-lead")).toBe("bad-characters");
    expect(validateSlug("trail-")).toBe("bad-characters");
    expect(validateSlug("double--hyphen")).toBe("bad-characters");
    expect(validateSlug("has space")).toBe("bad-characters");
    expect(validateSlug("under_score")).toBe("bad-characters");
  });

  it("refuses names that would shadow a route or the flagship", () => {
    // A page slugged `api` or `new` would shadow a real route; `the-wall`
    // would collide with the flagship page itself.
    for (const reserved of ["api", "new", "pages", "dashboard", "checkout", "the-wall"]) {
      expect(RESERVED_SLUGS.has(reserved)).toBe(true);
      expect(validateSlug(reserved)).toBe("reserved");
    }
  });
});

describe("slugify", () => {
  it("makes a usable slug out of free text", () => {
    expect(slugify("Harbour Lights Coffee")).toBe("harbour-lights-coffee");
    expect(slugify("  Ninepin  Bowling!  ")).toBe("ninepin-bowling");
    expect(slugify("Two   Rivers")).toBe("two-rivers");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugify("Café Miró")).toBe("cafe-miro");
  });

  it("never leaves a trailing hyphen after truncation", () => {
    const long = slugify("a".repeat(40) + " b");
    expect(long.endsWith("-")).toBe(false);
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX);
  });

  it("returns empty rather than throwing on text with nothing usable in it", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("handles", () => {
  it("derives a handle from a display name", () => {
    expect(handleFrom("Ana Ruiz", new Set())).toBe("ana-ruiz");
  });

  it("suffixes rather than colliding", () => {
    expect(handleFrom("Ana Ruiz", new Set(["ana-ruiz"]))).toBe("ana-ruiz-2");
    expect(handleFrom("Ana Ruiz", new Set(["ana-ruiz", "ana-ruiz-2"]))).toBe(
      "ana-ruiz-3",
    );
  });

  it("falls back for a name that slugifies to nothing", () => {
    // Otherwise every such name would collide on the empty string.
    expect(handleFrom("!!!", new Set())).toBe("pixeler");
    expect(handleFrom("!!!", new Set(["pixeler"]))).toBe("pixeler-2");
  });
});
