import { gridSnapshot } from "@/domain/services/pages";
import { getContainer } from "@/lib/container";
import { handler, ok } from "@/lib/http";

/**
 * The grid, as claims rather than blocks (DECISIONS D15).
 *
 * Not cached at the edge. A buyer who has just paid needs to see their own
 * blocks immediately, and a stale grid is how two people end up selecting the
 * same rectangle. The payload is small enough that this is not a problem.
 */
export const dynamic = "force-dynamic";

export const GET = handler(
  async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const c = await getContainer();
    return ok(await gridSnapshot(c, slug));
  },
);
