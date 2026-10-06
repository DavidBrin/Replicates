/**
 * The preset-only communication set (SPEC §7.3, D41).
 *
 * Forty-two lines, grouped exactly as published, plus eight code-drawn emoji
 * ids and a ninth `…` slot. Lines **28** and **29** are ally-only. Five lines
 * are RGD-verbatim and must never be reworded: **20, 21, 28, 29, 34**.
 *
 * There is no free-text path anywhere in the app: the client sends an index
 * and the renderer resolves the text from this table.
 */

export type DialogGroup =
  | "greetings"
  | "diplomacy"
  | "threats"
  | "reactions"
  | "apologies"
  | "encouragement"
  | "endgame";

export interface DialogLine {
  /** 1-based roster index, the only thing sent over the wire. */
  readonly id: number;
  readonly group: DialogGroup;
  readonly text: string;
  /** Offered only while an alliance is active (lines 28 and 29). */
  readonly allyOnly?: true;
  /** Verbatim from RGD; never reword (lines 20, 21, 28, 29, 34). */
  readonly verbatim?: true;
}

/** The group headings, in roster order. */
export const DIALOG_GROUPS: readonly { readonly id: DialogGroup; readonly label: string }[] = [
  { id: "greetings", label: "Greetings" },
  { id: "diplomacy", label: "Diplomacy (truce / alliance)" },
  { id: "threats", label: "Threats / taunts" },
  { id: "reactions", label: "Reactions (combat / dice)" },
  { id: "apologies", label: "Apologies / appeasement" },
  { id: "encouragement", label: "Encouragement / banter" },
  { id: "endgame", label: "Endgame" },
];

export const DIALOG_LINES: readonly DialogLine[] = [
  { id: 1, group: "greetings", text: "Hello!" },
  { id: 2, group: "greetings", text: "Good luck, everyone!" },
  { id: 3, group: "greetings", text: "Let's have a good game." },
  { id: 4, group: "greetings", text: "Ready when you are." },
  { id: 5, group: "greetings", text: "Back again — let's go!" },

  { id: 6, group: "diplomacy", text: "Truce?" },
  { id: 7, group: "diplomacy", text: "Alliance? Let's team up." },
  { id: 8, group: "diplomacy", text: "I won't attack you this turn — deal?" },
  { id: 9, group: "diplomacy", text: "Let's take down the leader together." },
  { id: 10, group: "diplomacy", text: "Your border is safe with me... for now." },
  { id: 11, group: "diplomacy", text: "Can we talk strategy?" },
  { id: 12, group: "diplomacy", text: "I'll trade you intel for safety." },

  { id: 13, group: "threats", text: "Your territory looks... undefended." },
  { id: 14, group: "threats", text: "I'm coming for that continent." },
  { id: 15, group: "threats", text: "This is my land now." },
  { id: 16, group: "threats", text: "You should have fortified that." },
  { id: 17, group: "threats", text: "Nowhere left to run." },
  { id: 18, group: "threats", text: "I'm going to win this." },
  { id: 19, group: "threats", text: "Big mistake leaving that border open." },

  { id: 20, group: "reactions", text: "NO DICE!", verbatim: true },
  { id: 21, group: "reactions", text: "THE DICE HATE ME!", verbatim: true },
  { id: 22, group: "reactions", text: "Nice move." },
  { id: 23, group: "reactions", text: "Didn't see that coming." },
  { id: 24, group: "reactions", text: "Lucky roll." },
  { id: 25, group: "reactions", text: "That hurt." },
  { id: 26, group: "reactions", text: "Not bad, not bad." },
  { id: 27, group: "reactions", text: "Ouch." },

  { id: 28, group: "apologies", text: "Sorry, I need to attack your territory.", allyOnly: true, verbatim: true },
  { id: 29, group: "apologies", text: "Attack my territory if you need to.", allyOnly: true, verbatim: true },
  { id: 30, group: "apologies", text: "My bad." },
  { id: 31, group: "apologies", text: "Nothing personal." },
  { id: 32, group: "apologies", text: "I had no choice." },

  { id: 33, group: "encouragement", text: "Thanks!" },
  { id: 34, group: "encouragement", text: "Great game.", verbatim: true },
  { id: 35, group: "encouragement", text: "Nice try." },
  { id: 36, group: "encouragement", text: "Respect." },
  { id: 37, group: "encouragement", text: "You're tougher than you look." },

  { id: 38, group: "endgame", text: "GG!" },
  { id: 39, group: "endgame", text: "Well played." },
  { id: 40, group: "endgame", text: "Down but not out." },
  { id: 41, group: "endgame", text: "I'll be back." },
  { id: 42, group: "endgame", text: "Good game, see you next time." },
];

/** The roster, bucketed by group, in roster order. */
export function linesByGroup(): readonly { readonly group: DialogGroup; readonly label: string;
  readonly lines: readonly DialogLine[] }[] {
  return DIALOG_GROUPS.map((g) => ({
    group: g.id,
    label: g.label,
    lines: DIALOG_LINES.filter((l) => l.group === g.id),
  }));
}

export function dialogLine(id: number): DialogLine | undefined {
  return DIALOG_LINES.find((l) => l.id === id);
}

/** The text of one line, or `""` for an index nobody published. */
export function dialogText(id: number): string {
  return dialogLine(id)?.text ?? "";
}

/**
 * Eight code-drawn glyphs, none of the original's paid sticker art, with a
 * ninth `…` slot that opens the full roster (SPEC §7.3).
 */
export interface EmojiGlyph {
  readonly id: string;
  readonly label: string;
}

export const EMOJI: readonly EmojiGlyph[] = [
  { id: "thumbsUp", label: "Thumbs up" },
  { id: "grin", label: "Grinning" },
  { id: "gasp", label: "Astonished" },
  { id: "fume", label: "Fuming" },
  { id: "tear", label: "Crying" },
  { id: "handshake", label: "Handshake" },
  { id: "swords", label: "Crossed swords" },
  { id: "flag", label: "White flag" },
];

/** The ninth tile. Not a glyph — it opens the roster. */
export const EMOJI_MORE = "…";

/**
 * Lines a bot may fire on an event, as cosmetic flavour (D42, **[ours]**).
 * Drawn from the same roster as a human's; never a bot-only vocabulary.
 */
export const BOT_REACTIONS: Readonly<Record<"lostTerritory" | "badRoll" | "conquered" | "eliminated",
  readonly number[]>> = {
    lostTerritory: [25, 27, 16],
    badRoll: [20, 21, 24],
    conquered: [15, 26, 22],
    eliminated: [40, 41, 39],
  };
