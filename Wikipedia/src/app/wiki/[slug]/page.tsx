import type { Metadata } from "next";
import { allArticles, getArticle } from "@/lib/registry";
import { ArticleShell } from "@/components/chrome";
import { NoArticle } from "./NoArticle";

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
    return { title: decodeURIComponent(slug).replace(/_/g, " ") };
  }
  return { title: article.meta.title };
}

/**
 * The generic wiki article route. An unknown slug is also where every
 * red-link stub (D3) lands — `ExternalLink`/`WikiLink` route to slugs like
 * `Website_not_yet_deployed` that are deliberately never registered.
 */
export default async function WikiArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);

  if (!article) {
    return <NoArticle slug={slug} />;
  }

  return (
    <ArticleShell title={article.meta.title} lastEdited={article.meta.lastEdited}>
      {article.body}
    </ArticleShell>
  );
}
