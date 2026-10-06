/**
 * The eight emoji glyph ids (SPEC §7.3's `[ours]` set: 👍 😄 😮 😤 😢 🤝 ⚔️
 * 🏳️).
 *
 * The wire carries an **id**, never the glyph and never free text (§5.9), so
 * this list is the whole vocabulary: the server validates against it and the
 * renderer draws its own artwork from it. It lives in its own tiny module
 * because both sides need it and neither should drag the other's dependencies
 * along — `zod` into the browser, or a client component into a route.
 *
 * The ninth tile in the drawer's 3×3 grid is `…`, which opens the 42-line
 * roster and is not itself sendable.
 */
export const EMOJI_IDS = [
  "thumbsUp",
  "grin",
  "surprise",
  "fume",
  "tear",
  "handshake",
  "swords",
  "whiteFlag",
] as const;

export type EmojiId = (typeof EMOJI_IDS)[number];
