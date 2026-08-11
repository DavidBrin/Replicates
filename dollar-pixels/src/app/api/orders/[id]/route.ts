import { AppError } from "@/domain/services/errors";
import { getActor, getContainer } from "@/lib/container";
import { handler, ok } from "@/lib/http";

/**
 * Poll an order.
 *
 * The return page uses this to wait for a webhook to land, so it must be
 * readable by its buyer and nobody else — an order carries what someone bought
 * and what they paid, which is not public the way the finished claim is.
 */
export const dynamic = "force-dynamic";

export const GET = handler(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const c = await getContainer();
    const order = await c.store.getOrder(id);
    if (!order) throw new AppError("not_found", "No such order.");

    const actor = await getActor();
    if (actor.kind !== "user" || actor.user.id !== order.buyerId) {
      // Deliberately 404 rather than 403: whether an order id exists is itself
      // information, and there is nothing useful to tell someone who is not
      // its buyer.
      throw new AppError("not_found", "No such order.");
    }

    const page = order.pageId ? await c.store.getPage(order.pageId) : undefined;

    return ok({
      id: order.id,
      kind: order.kind,
      status: order.status,
      amountCents: order.amountCents,
      createdAt: order.createdAt,
      settledAt: order.settledAt,
      pageSlug: page?.slug ?? null,
    });
  },
);
