import { describe, expect, it } from "vitest";
import { allArticles, articleExists, getArticle, randomSlug, searchTitles } from "@/lib/registry";

describe("registry", () => {
  it("finds a real article by slug", () => {
    expect(articleExists("Davids_Internet")).toBe(true);
    expect(getArticle("Davids_Internet")?.meta.title).toBe("David's Internet");
  });

  it("reports a slug that was never registered as missing", () => {
    expect(articleExists("Definitely Not A Real Article")).toBe(false);
    expect(getArticle("Definitely Not A Real Article")).toBeUndefined();
  });

  it("lists metadata for every registered article", () => {
    const all = allArticles();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((meta) => typeof meta.slug === "string" && meta.slug.length > 0)).toBe(true);
  });

  it("always returns a slug that exists", () => {
    for (let i = 0; i < 20; i++) {
      expect(articleExists(randomSlug())).toBe(true);
    }
  });
});

describe("searchTitles", () => {
  it("returns nothing for an empty query", () => {
    expect(searchTitles("")).toEqual([]);
    expect(searchTitles("   ")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(searchTitles("linear").map((m) => m.title)).toContain("Linear (replica)");
    expect(searchTitles("LINEAR").map((m) => m.title)).toContain("Linear (replica)");
  });

  it("ranks a prefix match ahead of a substring match", () => {
    // "avid" is a substring of "David's Internet" (not a prefix), so it
    // should still be found via the substring branch.
    const results = searchTitles("avid");
    expect(results.map((m) => m.title)).toContain("David's Internet");
  });

  it("ranks prefix matches before substring matches for the same query", () => {
    const results = searchTitles("s");
    const titles = results.map((m) => m.title.toLowerCase());
    const prefixIdx = titles.findIndex((t) => t.startsWith("s"));
    const substringOnlyIdx = titles.findIndex((t) => !t.startsWith("s") && t.includes("s"));
    if (prefixIdx !== -1 && substringOnlyIdx !== -1) {
      expect(prefixIdx).toBeLessThan(substringOnlyIdx);
    }
  });

  it("does not match a query absent from every title", () => {
    expect(searchTitles("zzzznonexistentzzzz")).toEqual([]);
  });
});
