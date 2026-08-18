import type { ReactNode } from "react";
import { articles } from "@/content/articles";

/**
 * Metadata every article carries, independent of its body content. Body
 * content is the JSX a content module exports separately (see
 * `ArticleModule` below); this is what the registry, search and the
 * category bar reason about without rendering anything.
 */
export interface ArticleMeta {
  slug: string;
  title: string;
  shortDescription: string;
  categories: string[];
  lastEdited: string;
}

/**
 * An entry in the article map: metadata plus the rendered body. Content
 * modules compose the body from `src/components/wiki` primitives; the
 * registry never inspects it, only routes to it.
 */
export interface ArticleModule {
  meta: ArticleMeta;
  body: ReactNode;
}

/**
 * Per-project metadata for the "channel guide" articles. Lives here as a
 * type only — the data itself belongs in `src/content/projects.ts`, owned
 * by the content agent, which imports this type.
 */
export interface ProjectInfo {
  name: string;
  slug: string;
  tagline: string;
  replicaOf: {
    name: string;
    url: string;
  };
  folder: string;
  stack: string[];
  testStats: string;
  builtWith: string;
  /** null until a project is actually deployed — renders as a red stub link. */
  liveUrl: string | null;
  screenshots: string[];
}

/** The static article map. Content agent fills this in via `src/content/articles/index.ts`. */
export type ArticleRegistry = Record<string, ArticleModule>;

function normalize(slug: string): string {
  return decodeURIComponent(slug).trim();
}

export function getArticle(slug: string): ArticleModule | undefined {
  return articles[normalize(slug)];
}

export function allArticles(): ArticleMeta[] {
  return Object.values(articles).map((article) => article.meta);
}

export function articleExists(slug: string): boolean {
  return normalize(slug) in articles;
}

export function randomSlug(): string {
  const slugs = Object.keys(articles);
  if (slugs.length === 0) {
    throw new Error("randomSlug() called with an empty article registry");
  }
  const index = Math.floor(Math.random() * slugs.length);
  return slugs[index];
}

/**
 * Case-insensitive title search, prefix matches ranked before substring
 * matches, each group alphabetical. Mirrors Wikipedia's own search-suggest
 * behaviour: typing "da" surfaces "David's Internet" above a title that
 * merely contains "da" somewhere in the middle.
 */
export function searchTitles(query: string): ArticleMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const prefix: ArticleMeta[] = [];
  const substring: ArticleMeta[] = [];

  for (const meta of allArticles()) {
    const title = meta.title.toLowerCase();
    if (title.startsWith(q)) {
      prefix.push(meta);
    } else if (title.includes(q)) {
      substring.push(meta);
    }
  }

  const byTitle = (a: ArticleMeta, b: ArticleMeta) => a.title.localeCompare(b.title);
  prefix.sort(byTitle);
  substring.sort(byTitle);

  return [...prefix, ...substring];
}
