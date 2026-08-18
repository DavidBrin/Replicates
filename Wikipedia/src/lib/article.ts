import { articles } from "@/content/articles";
import { normalize, type ArticleModule } from "@/lib/registry";

/**
 * `getArticle` — the only place that touches `@/content/articles` (the
 * full article-body map, ~82KB of JSX). Deliberately its own module, apart
 * from `@/lib/registry`: only server components (`src/app/wiki/[slug]/page.tsx`,
 * `src/app/page.tsx`) import this, so a client component that only needs
 * metadata never resolves a module graph that includes it. See
 * `src/lib/__tests__/bundle.build.test.ts`.
 */
export function getArticle(slug: string): ArticleModule | undefined {
  const key = normalize(slug);
  // Own-property-safe: a plain object's `[key]` also resolves inherited
  // properties (`__proto__`, `constructor`, `toString`, …), which would
  // otherwise let `/wiki/__proto__` resolve to `Object.prototype` instead
  // of `undefined` and crash downstream on `.meta.title`.
  return Object.hasOwn(articles, key) ? articles[key] : undefined;
}
