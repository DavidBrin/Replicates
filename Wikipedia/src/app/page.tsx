import { getArticle } from "@/lib/registry";
import { ArticleShell } from "@/components/chrome";

/**
 * The base page: the article "David's Internet" (slug `Davids_Internet`,
 * frozen contract with the content agent), rendered through the exact
 * same composition as `/wiki/<slug>` per SPEC.md §"Product requirements"
 * item 1.
 *
 * TODO(content agent): once `Davids_Internet` is registered in
 * `src/content/articles/index.ts`, the Sandbox fallback below stops
 * mattering — it only exists so this route keeps booting while both
 * agents work in parallel.
 */
export default function Home() {
  const article = getArticle("Davids_Internet") ?? getArticle("Sandbox");

  if (!article) {
    return <main className="py-8">No article registered.</main>;
  }

  return (
    <ArticleShell title={article.meta.title} lastEdited={article.meta.lastEdited}>
      {article.body}
    </ArticleShell>
  );
}
