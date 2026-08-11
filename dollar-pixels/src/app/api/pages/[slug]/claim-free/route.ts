import { claimFree } from "@/domain/services/checkout";
import { AppError } from "@/domain/services/errors";
import { settle } from "@/domain/services/fulfilment";
import { getContainer, requireUser } from "@/lib/container";
import { handler, ok, originOf, readJson } from "@/lib/http";
import { claimInputSchema, firstIssue } from "@/lib/schemas";

/**
 * Spend a private page creator's free allowance.
 *
 * Creates an order for zero and settles it in the same request, through the
 * ordinary fulfilment path rather than a second way of writing a claim
 * (DECISIONS D18). Nothing about this endpoint knows how to create a claim; it
 * only knows how to create an order and say it is paid.
 */
export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const parsed = claimInputSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("invalid", firstIssue(parsed.error));

    const user = await requireUser();
    const c = await getContainer();

    const order = await claimFree(
      { ...c, origin: originOf(req) },
      {
        slug,
        buyerId: user.id,
        rect: parsed.data.rect,
        caption: parsed.data.caption,
        colour: parsed.data.colour,
        tile: parsed.data.tile,
      },
    );

    const result = await settle(c, order.id, `allowance_${order.id}`);
    return ok({ orderId: order.id, claimId: result.claim?.id ?? null });
  },
);
