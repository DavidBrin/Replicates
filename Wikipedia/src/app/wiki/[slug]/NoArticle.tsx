import Link from "next/link";

/**
 * A Wikipedia-style "page does not exist" screen (MediaWiki's
 * `#noarticletext` box), rendered for any slug the registry doesn't know
 * about — including every deliberate red-link stub target (D3), so
 * "not deployed yet" and "genuinely never written" share one honest
 * landing page.
 */
export function NoArticle({ slug }: { slug: string }) {
  const title = decodeURIComponent(slug).replace(/_/g, " ");

  return (
    <main id="content" className="py-8">
      <h1 className="mb-2">{title}</h1>
      <div
        id="noarticletext"
        className="border border-[color:var(--rule)] bg-[color:var(--subtle-bg)] p-4 text-[14px]"
      >
        <p className="mb-2">
          This page is not deployed yet or does not exist.
        </p>
        <p className="m-0">
          Return to <Link href="/">Main page</Link>.
        </p>
      </div>
    </main>
  );
}
