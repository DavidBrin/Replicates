import { notFound, withErrors } from "@/lib/http";
import { resolveMap } from "@/lib/resolveMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/maps/[id]` — the full `MapDefinition`. Ids of the form
 * `seed:<levelId>` are the bundled campaign levels (the weekly picks that
 * did not come from the editor); anything else is a saved row. `404` otherwise.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrors(async () => {
    const { id } = await context.params;
    if (!id || id.length > 64) return notFound("map not found");
    const map = await resolveMap(id);
    if (!map) return notFound("map not found");
    return Response.json(map);
  });
}
