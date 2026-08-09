/**
 * Calendar arithmetic, kept free of any date library.
 *
 * Everything works in *local* civil days keyed by `YYYY-MM-DD`. Using a key
 * rather than a `Date` for bucketing avoids the classic off-by-one where two
 * instants on the same wall-clock day compare unequal, and it makes the day
 * buckets cheap to look up.
 */

/** Local-time `YYYY-MM-DD`. Never use `toISOString()` here — that shifts to UTC. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parses an ISO string into a local `Date`, tolerating a bare `YYYY-MM-DD`. */
export function parseIso(iso: string): Date {
  // A bare date string is parsed as UTC midnight by the spec, which renders as
  // the *previous* day west of Greenwich. Splitting it keeps it civil-local.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (bare) return new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]));
  return new Date(iso);
}

/** Midnight, local, on the same civil day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * The 6×7 grid a month view renders: leading days from the previous month,
 * the month itself, then trailing days. Always 42 cells so the grid height
 * never jumps between months.
 */
export function monthGrid(month: Date, weekStartsOn = 0): Date[] {
  const first = startOfMonth(month);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatMonthTitle(month: Date): string {
  return month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Short `Mon 4` style label used on cards and list rows. */
export function formatShortDate(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Every civil day covered by a date value, inclusive of both ends. */
export function daysBetween(startIso: string, endIso?: string): string[] {
  const start = startOfDay(parseIso(startIso));
  if (!endIso) return [dayKey(start)];
  const end = startOfDay(parseIso(endIso));
  const keys: string[] = [];
  // Guard the loop: a corrupt range must not spin forever.
  for (let d = start, i = 0; d <= end && i < 366; d = addDays(d, 1), i += 1) {
    keys.push(dayKey(d));
  }
  return keys.length > 0 ? keys : [dayKey(start)];
}
