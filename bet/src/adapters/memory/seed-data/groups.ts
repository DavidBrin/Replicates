/**
 * The 3 demo groups, with deliberately overlapping membership (SPEC's
 * "Sunday League", "The Roommates", "Fantasy 2026") so switching group tabs
 * actually changes who you see: `dev` is in all three; `jordan` bridges
 * Sunday League and The Roommates; `maya`, `marcus` and `sam` bridge Sunday
 * League and Fantasy 2026.
 */

export interface GroupSeed {
  key: string;
  slug: string;
  name: string;
  emoji: string;
  ownerHandle: string;
  memberHandles: readonly string[];
}

export const GROUP_SEEDS: readonly GroupSeed[] = [
  {
    key: "sunday-league",
    slug: "sunday-league",
    name: "Sunday League",
    emoji: "⚽",
    ownerHandle: "maya",
    memberHandles: ["dev", "maya", "jordan", "marcus", "sam", "liv", "chaosgremlin"],
  },
  {
    key: "the-roommates",
    slug: "the-roommates",
    name: "The Roommates",
    emoji: "🏠",
    ownerHandle: "dev",
    memberHandles: ["dev", "priya", "jordan", "kiwi", "noodle"],
  },
  {
    key: "fantasy-2026",
    slug: "fantasy-2026",
    name: "Fantasy 2026",
    emoji: "🏆",
    ownerHandle: "marcus",
    memberHandles: ["dev", "maya", "marcus", "yeetmaster", "birdie", "sam"],
  },
];
