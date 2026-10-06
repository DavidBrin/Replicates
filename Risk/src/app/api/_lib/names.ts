import "server-only";

/**
 * Display-name normalisation, the generated default, and the three
 * suggestions a `409` carries (SPEC §6.1).
 *
 * The rule the whole route hangs off: **never silently rename.** The player
 * chose that name; if it is held by somebody live they are told so and given
 * three alternatives that were probed free, rather than quietly becoming
 * "Napoleon-4".
 */

export const NAME_MIN = 2;
export const NAME_MAX = 20;
/** Enforced by `zod` here and by a `check` on `players.display_name`. */
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/** `btrim`, then collapse every internal whitespace run to one space. */
export function normaliseName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** The uniqueness key: `lower(normalised)`. What `name_key` stores. */
export function nameKey(normalised: string): string {
  return normalised.toLowerCase();
}

export function isValidName(normalised: string): boolean {
  return (
    normalised.length >= NAME_MIN &&
    normalised.length <= NAME_MAX &&
    NAME_PATTERN.test(normalised)
  );
}

/**
 * The suffixes a suggestion is built from, in the order they are tried.
 *
 * `-2`, `-3`, `-4` first, because a numbered duplicate reads as one; the
 * year-style suffixes are there so a name that collides with a *series* of
 * numbered holders still has somewhere to go, and they are period-appropriate
 * rather than random digits.
 */
const SUFFIXES = ["-2", "-3", "-4", "-5", "_1944", "_1812", "_1066", "-II", "-X"] as const;

/**
 * Three free alternatives to `base`, probed against `isFree`.
 *
 * A suffix that would push the name past 20 characters truncates the base
 * rather than being skipped, so a 20-character name still gets suggestions.
 * The probe stops at three — the sheet shows three inline — and if the whole
 * suffix list is somehow exhausted it returns however many it found.
 */
export async function suggestNames(
  base: string,
  isFree: (key: string) => Promise<boolean>,
  wanted = 3,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>([nameKey(base)]);
  for (const suffix of SUFFIXES) {
    if (out.length >= wanted) break;
    const room = NAME_MAX - suffix.length;
    const stem = base.length > room ? base.slice(0, room).trimEnd() : base;
    const candidate = normaliseName(`${stem}${suffix}`);
    if (!isValidName(candidate)) continue;
    const key = nameKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    if (await isFree(key)) out.push(candidate);
  }
  return out;
}

/**
 * The generated default: `<Adjective> <Noun> <NN>`, **our own wording** —
 * deliberately not RGD's unverified "Lucius The Cruel 33" phrasing (§6.1).
 *
 * Every pair fits inside 20 characters with the two-digit number, which is
 * why the lists are short words.
 */
const ADJECTIVES = [
  "Bold", "Brisk", "Calm", "Clever", "Daring", "Fierce", "Grim", "Iron",
  "Keen", "Lucky", "Noble", "Quiet", "Rapid", "Sly", "Stout", "Swift",
  "Vast", "Wary", "Wild", "Wise",
] as const;

const NOUNS = [
  "Admiral", "Baron", "Captain", "Consul", "Corsair", "Duke", "Envoy",
  "General", "Herald", "Hussar", "Lancer", "Marshal", "Pilot", "Ranger",
  "Regent", "Scout", "Sentry", "Sultan", "Tribune", "Viceroy",
] as const;

/** A random index in `[0, size)` with no modulo bias. */
function pick(size: number): number {
  const ceiling = Math.floor(256 / size) * size;
  const byte = new Uint8Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(byte);
    const value = byte[0]!;
    if (value < ceiling) return value % size;
  }
}

export function generateName(): string {
  const adjective = ADJECTIVES[pick(ADJECTIVES.length)]!;
  const noun = NOUNS[pick(NOUNS.length)]!;
  const number = 10 + pick(90);
  return `${adjective} ${noun} ${number}`;
}
