/**
 * Day-bucket label for grouping notifications (task-12-brief: "grouped by
 * day (Today, Yesterday, then dates)"). Pure, and mirrors
 * `domain/formatters.ts`'s own rule of taking an explicit `now` rather than
 * calling `Date.now()` internally — this file lives in `components/`, not
 * `domain/`, so it isn't bound by G1's layering test, but there's no reason
 * to reintroduce a hidden clock dependency anyway.
 */
export function dayBucketLabel(at: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  return at.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: at.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
