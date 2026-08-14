import { describe, expect, it } from "vitest";

import {
  compareResults,
  likePattern,
  parseQuery,
  scoreTextMatch,
  type SearchResult,
} from "@/components/search/query";

/**
 * The search grammar.
 *
 * Shared by the client dialog and `/api/search`, which is the reason it is a
 * module and not two `if` statements: a client that thinks `eng12` is free text
 * while the server resolves it as an identifier produces a dialog that shows
 * "searching…" and then the wrong thing.
 */

describe("parseQuery", () => {
  it("reads a full identifier", () => {
    expect(parseQuery("ENG-12").identifier).toEqual({ teamKey: "ENG", number: 12 });
  });

  it("is case-insensitive and dash-optional", () => {
    // Linear accepts `lin123` for `LIN-123` (§1.4). The dash is the character
    // people drop when retyping an id from memory.
    expect(parseQuery("eng-12").identifier).toEqual({ teamKey: "ENG", number: 12 });
    expect(parseQuery("eng12").identifier).toEqual({ teamKey: "ENG", number: 12 });
  });

  it("reads a bare number separately from an identifier", () => {
    const parsed = parseQuery("12");
    expect(parsed.identifier).toBeNull();
    expect(parsed.number).toBe(12);
  });

  it("treats free text as neither", () => {
    const parsed = parseQuery("cursor drift");
    expect(parsed.identifier).toBeNull();
    expect(parsed.number).toBeNull();
    expect(parsed.valid).toBe(true);
  });

  it("refuses a query too short to discriminate", () => {
    expect(parseQuery("a").valid).toBe(false);
    expect(parseQuery("").valid).toBe(false);
    expect(parseQuery("  ").valid).toBe(false);
  });

  it("accepts a short identifier anyway — A-1 is an exact answer", () => {
    expect(parseQuery("A-1").valid).toBe(true);
    expect(parseQuery("7").valid).toBe(true);
  });

  it("trims without losing the text", () => {
    expect(parseQuery("  drift  ").text).toBe("drift");
  });
});

describe("likePattern", () => {
  it("wraps the query in wildcards", () => {
    expect(likePattern("drift")).toBe("%drift%");
  });

  it("escapes the wildcards a user typed", () => {
    // Someone searching for "100%" means the character, not "match anything".
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("c:\\x")).toBe("%c:\\\\x%");
  });
});

describe("scoreTextMatch", () => {
  it("bands exact over prefix over word-boundary over mid-word", () => {
    const exact = scoreTextMatch("sync", "sync");
    const prefix = scoreTextMatch("Sync cursor drift", "sync");
    const boundary = scoreTextMatch("Realtime sync engine", "sync");
    const inside = scoreTextMatch("Resyncing the cursor", "sync");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(inside);
  });

  it("breaks ties towards the shorter title", () => {
    const short = scoreTextMatch("Sync drift", "sync");
    const long = scoreTextMatch(
      "Sync the cursor across a reconnect when the tab wakes up again",
      "sync",
    );
    expect(short).toBeGreaterThan(long);
  });

  it("never lets length beat a band", () => {
    // A 99-point length bonus against a 200-point band gap: a long prefix match
    // must still outrank a short mid-word one.
    const longPrefix = scoreTextMatch(
      "Sync everything everywhere all at once, forever and ever",
      "sync",
    );
    const shortInside = scoreTextMatch("Resync", "sync");
    expect(longPrefix).toBeGreaterThan(shortInside);
  });

  it("returns zero for a miss", () => {
    expect(scoreTextMatch("Cursor drift", "zzz")).toBe(0);
  });
});

describe("compareResults", () => {
  const result = (over: Partial<SearchResult>): SearchResult => ({
    type: "issue",
    id: "x",
    identifier: null,
    title: "t",
    subtitle: null,
    href: "/",
    stateType: null,
    stateColor: null,
    score: 0,
    ...over,
  });

  it("orders by score first", () => {
    const rows = [result({ score: 1 }), result({ score: 9 })].sort(compareResults);
    expect(rows[0]?.score).toBe(9);
  });

  it("puts an issue before a project at an equal score", () => {
    // The identifier syntax only ever means an issue, and a workspace has an
    // order of magnitude more of them.
    const rows = [
      result({ type: "project", score: 5 }),
      result({ type: "issue", score: 5 }),
    ].sort(compareResults);
    expect(rows[0]?.type).toBe("issue");
  });
});
