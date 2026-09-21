import { z } from "zod";

import { InvalidCursorError, mapsRepository } from "@/adapters/db/mapsRepository";
import { ensureReady } from "@/lib/boot";
import { checkMap } from "@/lib/engineValidate";
import { badRequest, jsonError, unprocessable, withErrors } from "@/lib/http";
import { MapDefinitionInputSchema, issueMessages } from "@/lib/mapSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/maps` — save an editor map. `201 { id }`; `400` when the body is
 * not a map; `422 { errors }` when the engine's rules reject it.
 *
 * `GET /api/maps?cursor=&limit=20` — newest first, keyset-paged.
 */

const ListQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function POST(request: Request): Promise<Response> {
  return withErrors(async () => {
    const body: unknown = await request.json().catch(() => undefined);
    if (body === undefined) return badRequest("body must be JSON");

    const parsed = MapDefinitionInputSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("body is not a map definition", { errors: issueMessages(parsed.error) });
    }

    const check = checkMap({ ...parsed.data, id: null });
    if (!check.engineReady) return jsonError(503, "engine not ready", { errors: check.ruleErrors });
    if (!check.valid) return unprocessable([...check.shapeErrors, ...check.ruleErrors]);

    await ensureReady();
    const { id } = await mapsRepository().create(parsed.data);
    return Response.json({ id }, { status: 201 });
  });
}

export async function GET(request: Request): Promise<Response> {
  return withErrors(async () => {
    const url = new URL(request.url);
    const query = ListQuery.safeParse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!query.success) return badRequest("bad query", { errors: issueMessages(query.error) });

    await ensureReady();
    try {
      const page = await mapsRepository().list(query.data);
      return Response.json(page);
    } catch (error) {
      if (error instanceof InvalidCursorError) return badRequest("cursor is not valid");
      throw error;
    }
  });
}
