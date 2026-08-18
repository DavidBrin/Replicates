/**
 * Shared fixtures for the e2e suite: the eight titles registered in
 * `src/content/articles/index.ts` (David's Internet + seven project
 * articles), and the seven Projects-table link texts mapped to the article
 * titles they land on. Kept in one place so a content-agent rename only
 * needs updating here.
 */
export const KNOWN_TITLES = [
  "David's Internet",
  "Linear (replica)",
  "Notion (replica)",
  "YouTube (replica)",
  "Super Smash (replica)",
  "Fake Phone",
  "Bet (app)",
  "Dollar Pixels",
] as const;

export const PROJECT_LINKS: Array<{ linkText: string; title: string }> = [
  { linkText: "Linear", title: "Linear (replica)" },
  { linkText: "Notion", title: "Notion (replica)" },
  { linkText: "YouTube", title: "YouTube (replica)" },
  { linkText: "Super Smash", title: "Super Smash (replica)" },
  { linkText: "Fake Phone", title: "Fake Phone" },
  { linkText: "Bet", title: "Bet (app)" },
  { linkText: "Dollar Pixels", title: "Dollar Pixels" },
];
