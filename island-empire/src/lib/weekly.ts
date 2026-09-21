import type { MapSummary } from "@/engine/types";

/**
 * Weekly-challenge selection (SPEC §5, D25, D38) — pure, and shared by the
 * route that serves the picks and the page that shows the countdown.
 *
 * Nothing about a week is stored. The three picks are a function of
 * `(ISO week, pool)`: seed a PRNG with `isoYear * 100 + isoWeek`, draw three
 * distinct entries from the pool sorted by id. Every visitor in the same ISO
 * week with the same pool sees the same three maps; on Monday 00:00 UTC the
 * seed changes and so do the picks. No cron, no row to lock in.
 */

export interface IsoWeek {
  /** The ISO week-numbering year — differs from the calendar year around 1 Jan. */
  year: number;
  /** 1..53 */
  week: number;
}

const DAY_MS = 86_400_000;

/**
 * ISO-8601 week of a date, in UTC.
 *
 * The standard trick: move the date to the Thursday of its week (ISO weeks
 * start on Monday and belong to the year that holds their Thursday), then
 * count weeks from that year's 1 January.
 */
export function isoWeek(date: Date): IsoWeek {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday → 7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / DAY_MS + 1) / 7);
  return { year, week };
}

/** `"2026-W39"` — the key `localProgress.challengeMedals` is scoped by. */
export function weekKey(date: Date): string {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The Monday 00:00 UTC that starts `date`'s ISO week. */
export function weekStartUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

/** The next Monday 00:00 UTC strictly after `date` — when the picks roll over. */
export function nextMondayUtc(date: Date): Date {
  const start = weekStartUtc(date);
  return new Date(start.getTime() + 7 * DAY_MS);
}

/** mulberry32: a 32-bit seeded generator, good enough to shuffle a handful of ids. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CHALLENGE_COUNT = 3;

/**
 * The week's three challenge maps, in rank order (#1, #2, #3).
 *
 * `pool` is sorted by id before drawing so the result does not depend on the
 * order the caller assembled it in (seeded levels first, then rows, or the
 * reverse). Fewer than three in the pool returns what exists.
 */
export function selectWeeklyChallenge(date: Date, pool: readonly MapSummary[]): MapSummary[] {
  const { year, week } = isoWeek(date);
  const rng = mulberry32(year * 100 + week);
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Deduplicate by id defensively — a pool that lists a map twice must not
  // produce the same challenge twice.
  const unique: MapSummary[] = [];
  const seen = new Set<string>();
  for (const map of sorted) {
    if (seen.has(map.id)) continue;
    seen.add(map.id);
    unique.push(map);
  }
  const picks: MapSummary[] = [];
  const remaining = unique;
  while (picks.length < CHALLENGE_COUNT && remaining.length > 0) {
    const i = Math.floor(rng() * remaining.length);
    picks.push(remaining.splice(i, 1)[0]!);
  }
  return picks;
}

/** A 32-bit FNV-1a of a string — the session seed for a challenge attempt. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** "6d 13h 59m" — the countdown label; never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(total / (60 * 24));
  const hours = Math.floor((total % (60 * 24)) / 60);
  const minutes = total % 60;
  return `${days}d ${hours}h ${minutes}m`;
}
