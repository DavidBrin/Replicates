import { EMOJI_IDS } from "@/net/emojiIds";

/**
 * The eight glyph ids and a stand-in glyph for each (SPEC §7.3's `[ours]`
 * set: 👍 😄 😮 😤 😢 🤝 ⚔️ 🏳️).
 *
 * The **ids** are the wire contract and are declared once, in
 * `src/net/emojiIds.ts`, because the server validates against them; this map
 * is only how the lobby's lighter chat column draws them. §7.3's real artwork is
 * eight code-drawn SVG glyphs in the in-game drawer, which is S4's — a
 * character here is a readable placeholder in a screen that is not the
 * drawer, not a second design.
 */
export const EMOJI_GLYPHS: Record<string, string> = {
  thumbsUp: "👍",
  grin: "😄",
  surprise: "😮",
  fume: "😤",
  tear: "😢",
  handshake: "🤝",
  swords: "⚔️",
  whiteFlag: "🏳️",
};

export { EMOJI_IDS };
