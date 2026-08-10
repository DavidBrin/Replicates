/**
 * Pure formatting rules. No DOM, no React — these are the small, exactly-
 * specified behaviours that a replica gets subtly wrong, so they are isolated
 * here and unit-tested against the researched rules rather than eyeballed.
 */

/**
 * The iOS call-timer format (research/ios-call-ui.md §2.2).
 *
 * Under an hour: `M:SS` — minutes with NO leading zero, seconds always
 * two-digit. The very first tick therefore reads `0:01`, not `00:01`; getting
 * this wrong is the most common tell in a fake call screen.
 *
 * At or past an hour: `H:MM:SS`, hours with no leading zero.
 *
 * Negative input is clamped to zero rather than throwing: this is fed by a
 * wall-clock delta, and a user changing their device clock mid-call should
 * produce a stuttering timer, never a crash on the call screen.
 */
export function formatCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const ss = String(seconds).padStart(2, "0");
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}

/**
 * Android shows the same information but is not bound to Apple's no-leading-
 * zero convention; stock Dialer reads `MM:SS`. Kept separate rather than
 * parameterised so each skin's rule is independently testable.
 */
export function formatCallDurationAndroid(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours === 0) return `${mm}:${ss}`;
  return `${hours}:${mm}:${ss}`;
}

/**
 * Social-platform viewer-count abbreviation (research/instagram-live-ui.md §7):
 * exact below 1,000 (with thousands separators never needed there), `X.XK`
 * through 99K, whole `XXXK` from 100K, `X.XM` past a million.
 *
 * Truncates rather than rounds — a live counter that rounds up reads as 1.0K
 * while 999 people are watching, and the number visibly jumping backwards when
 * one viewer leaves is the kind of detail that draws a second look.
 */
export function formatViewerCount(count: number): string {
  const n = Math.max(0, Math.floor(count || 0));
  if (n < 1_000) return String(n);
  if (n < 100_000) {
    const k = Math.floor(n / 100) / 10;
    return `${k.toFixed(1)}K`;
  }
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  const m = Math.floor(n / 100_000) / 10;
  return `${m.toFixed(1)}M`;
}

/**
 * Initials for the no-photo monogram. iOS renders one or two letters; anything
 * more is truncated rather than squeezed.
 *
 * Uses `Intl.Segmenter` where available so a name whose first character is an
 * emoji or a surrogate pair (an increasingly common way to save a contact)
 * yields that whole grapheme instead of half a code point.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const take = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return take.map(firstGrapheme).join("").toUpperCase();
}

function firstGrapheme(word: string): string {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = segmenter.segment(word)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return [...word][0] ?? "";
}
