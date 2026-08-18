import { NoArticle } from "./NoArticle";

/**
 * Rendered when `src/app/wiki/[slug]/page.tsx` calls `notFound()` for an
 * unregistered slug — including every deliberate red-link stub target (D3).
 * The response now carries a real HTTP 404 instead of the soft-200 the
 * inline render used to give.
 *
 * `not-found.tsx` does not reliably receive this segment's `params` here
 * (verified empirically: `next build` crashes trying to destructure them
 * during static generation of unrelated `/wiki/[slug]` routes), so this
 * renders the slug-agnostic screen rather than deriving a title from the
 * slug that triggered it.
 */
export default function WikiNotFound() {
  return <NoArticle />;
}
