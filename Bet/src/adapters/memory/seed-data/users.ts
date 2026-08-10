/**
 * The 12 demo users. `dev` is the default "you" (David's ambiguity
 * resolution) — always seeded first so it's the natural "first user" for
 * any code that just grabs `users.list()[0]`. The other 11 handles mix
 * plain first-names, nicknames and joke handles, the way a real friend
 * group's handles actually look.
 */

import { AVATAR_PALETTE } from "./palette";

export interface UserSeed {
  handle: string;
  displayName: string;
  avatarInitials: string;
  avatarColor: string;
}

const RAW_USERS: Omit<UserSeed, "avatarColor">[] = [
  { handle: "dev", displayName: "Dev", avatarInitials: "DV" },
  { handle: "maya", displayName: "Maya Chen", avatarInitials: "MC" },
  { handle: "jordan", displayName: "Jordan Ruiz", avatarInitials: "JR" },
  { handle: "priya", displayName: "Priya Patel", avatarInitials: "PP" },
  { handle: "marcus", displayName: "Marcus Bell", avatarInitials: "MB" },
  { handle: "sam", displayName: "Sam Okafor", avatarInitials: "SO" },
  { handle: "liv", displayName: "Liv Torres", avatarInitials: "LT" },
  { handle: "chaosgremlin", displayName: "Chaos Gremlin", avatarInitials: "BW" },
  { handle: "yeetmaster", displayName: "Yeetmaster", avatarInitials: "CD" },
  { handle: "kiwi", displayName: "Kiwi", avatarInitials: "KF" },
  { handle: "noodle", displayName: "Noodle", avatarInitials: "NH" },
  { handle: "birdie", displayName: "Birdie", avatarInitials: "BS" },
];

/** Every demo user, `dev` first, each with a distinct `avatarColor` from
 * `AVATAR_PALETTE` in order. */
export const USER_SEEDS: readonly UserSeed[] = RAW_USERS.map((u, i) => ({
  ...u,
  avatarColor: AVATAR_PALETTE[i % AVATAR_PALETTE.length]!,
}));

export const DEFAULT_USER_HANDLE = "dev";
