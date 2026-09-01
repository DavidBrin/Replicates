import type { ArticleMeta } from "@/lib/registry";
import { projects } from "@/content/projects";

/**
 * Every article's `ArticleMeta` record, and nothing else.
 *
 * This module deliberately imports only `@/content/projects` (plain data)
 * and never any article body module (`./linear`, `./notion`, …). Search,
 * existence checks and "random article" all run off `articleMetas` rather
 * than the full `articles` registry in `./index.ts`, so a client component
 * that only needs metadata (`SearchBox`, `Navigation`, `WikiLink`) never
 * pulls the ~82KB of article JSX into its bundle. See
 * `src/lib/__tests__/bundle.build.test.ts` for the guard.
 */

function projectSlug(name: string): string {
  const project = projects.find((p) => p.name === name);
  if (!project) throw new Error(`no project named "${name}" in @/content/projects`);
  return project.slug;
}

export const davidsInternetMeta: ArticleMeta = {
  slug: "Davids_Internet",
  title: "David's Internet",
  shortDescription: "A search engine over a portfolio of software replicas",
  categories: ["Portfolio indexes", "Software replicas", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const linearMeta: ArticleMeta = {
  slug: projectSlug("Linear"),
  title: "Linear (replica)",
  shortDescription: "A rebuild of the Linear issue tracker",
  categories: ["Software replicas", "Issue tracking systems"],
  lastEdited: "18 August 2026",
};

export const notionMeta: ArticleMeta = {
  slug: projectSlug("Notion"),
  title: "Notion (replica)",
  shortDescription: "A rebuild of the Notion workspace tool, entirely client-side",
  categories: ["Software replicas", "Note-taking software"],
  lastEdited: "18 August 2026",
};

export const youtubeMeta: ArticleMeta = {
  slug: projectSlug("YouTube"),
  title: "YouTube (replica)",
  shortDescription: "A rebuild of YouTube's core video platform",
  categories: ["Software replicas", "Video hosting services"],
  lastEdited: "18 August 2026",
};

export const superSmashMeta: ArticleMeta = {
  slug: projectSlug("Super Smash"),
  title: "Super Smash (replica)",
  shortDescription: "A browser rebuild of Super Smash Bros. Ultimate's versus mode",
  categories: ["Software replicas", "Fighting games", "Browser games"],
  lastEdited: "18 August 2026",
};

export const fakePhoneMeta: ArticleMeta = {
  slug: projectSlug("Fake Phone"),
  title: "Fake Phone",
  shortDescription: "A personal-safety app replicating iOS and Android incoming-call screens",
  categories: ["Software replicas", "Personal safety software", "Progressive web applications"],
  lastEdited: "18 August 2026",
};

export const betMeta: ArticleMeta = {
  slug: projectSlug("Bet"),
  title: "Bet (app)",
  shortDescription: "A private, friend-first prediction market",
  categories: ["Software replicas", "Prediction markets"],
  lastEdited: "18 August 2026",
};

export const dollarPixelsMeta: ArticleMeta = {
  slug: projectSlug("Dollar Pixels"),
  title: "Dollar Pixels",
  shortDescription: "A rebuild of the Million Dollar Homepage",
  categories: ["Software replicas", "Advertising websites"],
  lastEdited: "18 August 2026",
};

/** Every registered article's metadata, in registry order. */
export const articleMetas: ArticleMeta[] = [
  davidsInternetMeta,
  linearMeta,
  notionMeta,
  youtubeMeta,
  superSmashMeta,
  fakePhoneMeta,
  betMeta,
  dollarPixelsMeta,
];
