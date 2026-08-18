import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allArticles, safeDecode } from "@/lib/registry";
import { getArticle } from "@/lib/article";
import { ArticleShell } from "@/components/chrome";

export function generateStaticParams() {
  return allArticles().map((meta) => ({ slug: meta.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) {
    return { title: safeDecode(slug).replace(/_/g, " ") };
  }
  return { title: article.meta.title };
}

/**
 * The generic wiki article route. An unknown slug is also where every
 * red-link stub (D3) lands — `ExternalLink`/`WikiLink` route to slugs like
 * `Website_not_yet_deployed` that are deliberately never registered. Those
 * now resolve through `notFound()` to `./not-found.tsx`, so the shared
 * "page does not exist" screen still renders, but the response carries a
 * real HTTP 404 instead of a soft 200.
 */
export default async function WikiArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);

  if (!article) {
    notFound();
  }

  return (
    <ArticleShell title={article.meta.title} lastEdited={article.meta.lastEdited}>
      {article.body}
    </ArticleShell>
  );
}
