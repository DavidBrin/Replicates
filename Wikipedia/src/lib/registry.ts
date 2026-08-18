import type { ReactNode } from "react";
import { articleMetas } from "@/content/articles/meta";

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

/**
 * `decodeURIComponent`, but safe against a slug that is already decoded.
 * Next's dynamic route params arrive pre-decoded (verified empirically: a
 * request for `/wiki/%25` reaches this module with `slug === "%"`, not
 * `"%25"`), so decoding again throws a `URIError` on any percent sign that
 * isn't itself valid percent-encoding — e.g. `decodeURIComponent("%")`.
 * Falling back to the raw string on failure means a slug like that is
 * treated as literally itself rather than crashing the route.
 */
export function safeDecode(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export function normalize(slug: string): string {
  return safeDecode(slug).trim();
}

/**
 * Metadata-only surface: `allArticles`/`articleExists`/`randomSlug`/
 * `searchTitles` read `src/content/articles/meta.ts` and never import
 * `src/content/articles/index.ts` (the article bodies). This file must stay
 * that way — `getArticle`, which does need bodies for route rendering,
 * lives in `@/lib/article` specifically so a client component that only
 * needs metadata (`SearchBox`, `Navigation`, `WikiLink`) can import from
 * here without pulling every article's JSX into its bundle. A static
 * import of `@/content/articles` anywhere in *this* file would defeat that
 * split even if nothing here calls it — see
 * `src/lib/__tests__/bundle.build.test.ts`.
 */

export function allArticles(): ArticleMeta[] {
  return articleMetas;
}

export function articleExists(slug: string): boolean {
  const key = normalize(slug);
  return articleMetas.some((meta) => meta.slug === key);
}

export function randomSlug(): string {
  if (articleMetas.length === 0) {
    throw new Error("randomSlug() called with an empty article registry");
  }
  const index = Math.floor(Math.random() * articleMetas.length);
  return articleMetas[index].slug;
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
