import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { MapSummary } from "@/engine/types";
import {
  formatCountdown,
  hashSeed,
  isoWeek,
  nextMondayUtc,
  selectWeeklyChallenge,
  weekKey,
  weekStartUtc,
} from "@/lib/weekly";

function summary(id: string): MapSummary {
  return {
    id,
    name: `Map ${id}`,
    author: "a",
    width: 10,
    height: 10,
    biome: "grass",
    players: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const pool = (n: number) => Array.from({ length: n }, (_, i) => summary(`m${String(i).padStart(3, "0")}`));

describe("isoWeek", () => {
  it.each([
    ["2026-09-21T00:00:00Z", 2026, 39], // a Monday
    ["2026-09-27T23:59:59Z", 2026, 39], // the Sunday of the same week
    ["2026-09-28T00:00:00Z", 2026, 40],
    ["2024-12-30T12:00:00Z", 2025, 1], // ISO year rolls before the calendar year
    ["2021-01-03T12:00:00Z", 2020, 53], // …and after it
    ["2027-01-01T00:00:00Z", 2026, 53],
  ])("%s → %d-W%d", (iso, year, week) => {
    expect(isoWeek(new Date(iso))).toEqual({ year, week });
  });

  it("formats the week key with a two-digit week", () => {
    expect(weekKey(new Date("2025-01-01T00:00:00Z"))).toBe("2025-W01");
    expect(weekKey(new Date("2026-09-21T00:00:00Z"))).toBe("2026-W39");
  });
});

describe("week boundaries", () => {
  it("starts on the Monday and rolls over at the next Monday 00:00 UTC", () => {
    const d = new Date("2026-09-24T15:30:00Z"); // Thursday
    expect(weekStartUtc(d).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(nextMondayUtc(d).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  it("treats a Monday as the start of its own week", () => {
    const monday = new Date("2026-09-21T00:00:00Z");
    expect(weekStartUtc(monday).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(nextMondayUtc(monday).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  it("nextMondayUtc is always strictly after the date and at most 7 days away", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }), (date) => {
        const next = nextMondayUtc(date);
        expect(next.getUTCDay()).toBe(1);
        expect(next.getTime()).toBeGreaterThan(date.getTime());
        expect(next.getTime() - date.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
      }),
    );
  });
});

describe("selectWeeklyChallenge", () => {
  it("picks three distinct maps", () => {
    const picks = selectWeeklyChallenge(new Date("2026-09-21T00:00:00Z"), pool(10));
    expect(picks).toHaveLength(3);
    expect(new Set(picks.map((p) => p.id)).size).toBe(3);
  });

  it("returns what exists when the pool is short", () => {
    expect(selectWeeklyChallenge(new Date(), pool(2))).toHaveLength(2);
    expect(selectWeeklyChallenge(new Date(), [])).toEqual([]);
  });

  it("is the same for every instant inside one ISO week, independent of pool order", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }),
        fc.integer({ min: 0, max: 7 * 86_400_000 - 1 }),
        fc.integer({ min: 3, max: 30 }),
        (date, offsetMs, size) => {
          const start = weekStartUtc(date);
          const t1 = new Date(start.getTime() + offsetMs);
          const p = pool(size);
          const a = selectWeeklyChallenge(start, p).map((m) => m.id);
          const b = selectWeeklyChallenge(t1, [...p].reverse()).map((m) => m.id);
          expect(b).toEqual(a);
        },
      ),
    );
  });

  it("changes across a week boundary (for most weeks — pinned on real dates)", () => {
    const p = pool(12);
    const before = selectWeeklyChallenge(new Date("2026-09-27T23:59:59Z"), p).map((m) => m.id);
    const after = selectWeeklyChallenge(new Date("2026-09-28T00:00:00Z"), p).map((m) => m.id);
    expect(after).not.toEqual(before);
  });

  it("differs between weeks more often than not over a year", () => {
    const p = pool(20);
    let changes = 0;
    let prev: string[] = [];
    for (let w = 0; w < 52; w += 1) {
      const d = new Date(Date.UTC(2026, 0, 5) + w * 7 * 86_400_000);
      const ids = selectWeeklyChallenge(d, p).map((m) => m.id);
      if (ids.join() !== prev.join()) changes += 1;
      prev = ids;
    }
    expect(changes).toBeGreaterThan(45);
  });

  it("never picks a duplicate even when the pool repeats an id", () => {
    const p = [...pool(3), ...pool(3)];
    const picks = selectWeeklyChallenge(new Date("2026-09-21T00:00:00Z"), p);
    expect(new Set(picks.map((m) => m.id)).size).toBe(3);
  });

  it("pins a known week so a refactor of the PRNG is visible", () => {
    const picks = selectWeeklyChallenge(new Date("2026-09-21T00:00:00Z"), pool(10)).map((m) => m.id);
    expect(picks).toMatchInlineSnapshot(`
      [
        "m006",
        "m009",
        "m000",
      ]
    `);
  });
});

describe("helpers", () => {
  it("hashSeed is deterministic and 32-bit", () => {
    expect(hashSeed("2026-W39")).toBe(hashSeed("2026-W39"));
    expect(hashSeed("2026-W39")).not.toBe(hashSeed("2026-W40"));
    expect(hashSeed("x")).toBeGreaterThanOrEqual(0);
    expect(hashSeed("x")).toBeLessThanOrEqual(0xffffffff);
  });

  it("formatCountdown", () => {
    expect(formatCountdown(6 * 86_400_000 + 13 * 3_600_000 + 59 * 60_000 + 30_000)).toBe("6d 13h 59m");
    expect(formatCountdown(0)).toBe("0d 0h 0m");
    expect(formatCountdown(-5)).toBe("0d 0h 0m");
  });
});
