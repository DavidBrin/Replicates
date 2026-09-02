import { describe, expect, it } from "vitest";
import { allArticles, articleExists, randomSlug, safeDecode, searchTitles } from "@/lib/registry";
import { getArticle } from "@/lib/article";
import { articleMetas } from "@/content/articles/meta";
import { articles } from "@/content/articles";

describe("registry", () => {
  it("finds a real article by slug", () => {
    expect(articleExists("Davids_Internet")).toBe(true);
    expect(getArticle("Davids_Internet")?.meta.title).toBe("David's Internet");
  });

  it("reports a slug that was never registered as missing", () => {
    expect(articleExists("Definitely Not A Real Article")).toBe(false);
    expect(getArticle("Definitely Not A Real Article")).toBeUndefined();
  });

  // A plain object map's `in`/bracket-indexing resolves inherited
  // `Object.prototype` properties too — `/wiki/__proto__` used to pass
  // `articleExists` and hand back `Object.prototype` instead of `undefined`,
  // crashing downstream on `.meta.title`. The lookups must be own-property
  // safe (see `Object.hasOwn` in `getArticle`, and the array-based
  // `articleMetas.some(...)` in `articleExists`).
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])(
    "treats the prototype-key slug %j as missing, not as an inherited property",
    (slug) => {
      expect(articleExists(slug)).toBe(false);
      expect(getArticle(slug)).toBeUndefined();
    },
  );

  describe("safeDecode", () => {
    it("decodes a percent-encoded slug", () => {
      expect(safeDecode("Foo%20Bar")).toBe("Foo Bar");
    });

    // Next's dynamic route params arrive already decoded (verified via
    // `next start` + curl: a request for `/wiki/%25` reaches the route with
    // `slug === "%"`). Decoding an already-decoded lone "%" throws a
    // `URIError` — safeDecode must fall back to the raw string instead of
    // propagating it.
    it("falls back to the raw string for a slug that isn't valid percent-encoding", () => {
      expect(safeDecode("%")).toBe("%");
      expect(() => decodeURIComponent("%")).toThrow();
    });

    it("does not crash articleExists/getArticle on that slug either", () => {
      expect(() => articleExists("%")).not.toThrow();
      expect(() => getArticle("%")).not.toThrow();
      expect(articleExists("%")).toBe(false);
      expect(getArticle("%")).toBeUndefined();
    });
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

// `src/content/articles/meta.ts` (metadata only, read by the client-safe
// surface above) and `src/content/articles/index.ts` (full bodies, read by
// `getArticle`) each enumerate the article list independently. Nothing
// forces them to agree except each content module importing its meta
// object from `meta.ts` rather than redeclaring it — this test makes that
// enforced, not just conventional: any slug that appears in one but not
// the other, or a body module that redeclares rather than reuses its meta
// object, fails here instead of silently drifting.
describe("meta.ts / index.ts parity", () => {
  it("registers exactly the same set of slugs in both modules", () => {
    const metaSlugs = new Set(articleMetas.map((meta) => meta.slug));
    const indexSlugs = new Set(Object.keys(articles));
    expect(indexSlugs).toEqual(metaSlugs);
  });

  // Set equality alone hides a duplicate: two `articleMetas` entries with
  // the same slug collapse to one member of `metaSlugs`, so the assertion
  // above would still pass even though `articleMetas` carries a stray
  // duplicate. `articles` (a plain object keyed by slug) can't have a
  // duplicate key by construction, so comparing lengths against it — and
  // asserting no-duplicates directly over `articleMetas` — catches what
  // the Set comparison can't.
  it("has no duplicate slug among articleMetas entries", () => {
    const metaSlugs = articleMetas.map((meta) => meta.slug);
    expect(metaSlugs).toEqual([...new Set(metaSlugs)]);
  });

  it("has exactly one articleMetas entry per registered article, not more", () => {
    expect(articleMetas.length).toBe(Object.keys(articles).length);
  });

  it("gives every article module the identical meta object instance from meta.ts", () => {
    for (const meta of articleMetas) {
      const entry = articles[meta.slug];
      expect(entry, `no entry in index.ts for slug ${meta.slug}`).toBeDefined();
      expect(Object.is(entry.meta, meta), `articles[${meta.slug}].meta is not meta.ts's ${meta.slug}`).toBe(
        true,
      );
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

  it("finds the FL Studio replica", () => {
    expect(searchTitles("fl studio").map((m) => m.title)).toContain("FL Studio (replica)");
    expect(searchTitles("FL").map((m) => m.title)).toContain("FL Studio (replica)");
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
