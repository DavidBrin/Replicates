import { PageRoute } from "./PageRoute";

/**
 * Dynamic page route.
 *
 * `params` is a promise in Next 16 — it must be awaited. Kept as a thin
 * server component so the client boundary stays a single file below it.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  return <PageRoute pageId={pageId} />;
}
