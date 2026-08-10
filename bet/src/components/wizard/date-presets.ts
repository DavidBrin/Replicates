/**
 * Close-date helpers for Step 1's quick presets (SPEC §3.4: "a `closesAt`
 * datetime-local input plus quick presets: tonight, this weekend, in a
 * week"). Pure functions of an explicit `now` (house style — see
 * `src/domain/formatters.ts`), so they're deterministic and testable
 * without mocking `Date.now()`.
 */

const SATURDAY = 6;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Formats `date` as `<input type="datetime-local">`'s native value —
 * LOCAL wall-clock components, no timezone/offset (matches the browser's
 * own format exactly, so round-tripping through `new Date(value)` later
 * reconstructs the same local instant regardless of the machine's
 * timezone). */
export function toDatetimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Tonight at 9pm local time — tomorrow at 9pm if it's already past 9pm. */
export function tonightPreset(now: Date): Date {
  const candidate = new Date(now);
  candidate.setHours(21, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

/** The upcoming Saturday at noon local time — next Saturday (not today) if
 * today already IS Saturday past noon. */
export function thisWeekendPreset(now: Date): Date {
  const candidate = new Date(now);
  const daysUntilSaturday = (SATURDAY - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + daysUntilSaturday);
  candidate.setHours(12, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

/** Exactly 7 days from now, same time of day. */
export function inAWeekPreset(now: Date): Date {
  const candidate = new Date(now);
  candidate.setDate(candidate.getDate() + 7);
  return candidate;
}
