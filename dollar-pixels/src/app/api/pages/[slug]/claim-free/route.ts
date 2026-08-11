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

    // Both halves in ONE transaction.
    //
    // Creating the order and settling it were two separate calls, and the gap
    // between them leaked free blocks: `claimFree` increments `allowanceUsed`
    // and takes a hold, so an interruption before settlement — a timeout, a
    // deploy — left the allowance spent with no claim to show for it. Nothing
    // could give it back either: the hold expires on its own (DECISIONS D9),
    // but no code path decrements `allowanceUsed`, and nothing ever calls
    // `release` on an allowance order.
    //
    // Nested `transact` joins the outer transaction rather than opening a new
    // one, so the two now commit or roll back together.
    const result = await c.store.transact(async (tx) => {
      const scoped = { ...c, store: tx };
      const order = await claimFree(
        { ...scoped, origin: originOf(req) },
        {
          slug,
          buyerId: user.id,
          rect: parsed.data.rect,
          caption: parsed.data.caption,
          colour: parsed.data.colour,
          tile: parsed.data.tile,
        },
      );
      const settled = await settle(scoped, order.id, `allowance_${order.id}`);
      return { orderId: order.id, claimId: settled.claim?.id ?? null };
    });

    return ok(result);
  },
);
