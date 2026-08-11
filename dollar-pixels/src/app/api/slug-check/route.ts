import { checkSlug } from "@/domain/services/pages";
import { getContainer } from "@/lib/container";
import { handler, ok } from "@/lib/http";

/**
 * Live availability for the create-page form.
 *
 * Advisory only. The real check runs at checkout and again at settlement,
 * because two people can be paying for the same name at once and this endpoint
 * cannot reserve anything.
 */
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  const c = await getContainer();
  return ok(await checkSlug(c.store, slug.trim().toLowerCase()));
});
