import { NoArticle } from "./wiki/[slug]/NoArticle";

/**
 * Any route outside `/wiki/[slug]` that doesn't exist (there is no slug to
 * derive a title from here, unlike the wiki-scoped not-found.tsx) still
 * gets the same Wikipedia-style "page does not exist" screen, with a real
 * HTTP 404.
 */
export default function NotFound() {
  return <NoArticle />;
}
