import { buyBlocks } from "@/domain/services/checkout";
import { AppError } from "@/domain/services/errors";
import { getContainer, requireUser } from "@/lib/container";
import { handler, ok, originOf, readJson } from "@/lib/http";
import { claimInputSchema, firstIssue } from "@/lib/schemas";

/**
 * Buy a rectangle of blocks.
 *
 * The body carries a selection and some artwork. It does not carry a price,
 * and there is no field here that could — the amount is recomputed from the
 * rectangle server-side (SPEC §5).
 */
export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const parsed = claimInputSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("invalid", firstIssue(parsed.error));

    const user = await requireUser();
    const c = await getContainer();

    const { order, checkout } = await buyBlocks(
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

    return ok({
      orderId: order.id,
      amountCents: order.amountCents,
      redirectUrl: checkout.redirectUrl,
      holdMinutes: 30,
    });
  },
);
