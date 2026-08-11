import { AppError } from "@/domain/services/errors";
import { release, settle } from "@/domain/services/fulfilment";
import { getContainer, requireUser } from "@/lib/container";
import { handler, ok, readJson } from "@/lib/http";
import { z } from "zod";

/**
 * The fake-money "Pay" button.
 *
 * This is the mock provider's equivalent of a Stripe webhook, and it is the
 * whole reason the mock path is trustworthy: it calls exactly the same
 * `settle` that Stripe's webhook calls, with exactly the same arguments
 * (DECISIONS D10).
 *
 * It returns 404 — not 403 — when the deployment is on Stripe. The endpoint
 * does not exist in a real deployment, and saying "forbidden" would imply it
 * might be reachable with the right credentials.
 */
const bodySchema = z.object({
  outcome: z.enum(["paid", "declined", "cancelled"]).default("paid"),
});

export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const c = await getContainer();
    if (c.payments.isLive) {
      throw new AppError("not_found", "Not found.");
    }

    const { id } = await ctx.params;
    const parsed = bodySchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("invalid", "Unknown outcome.");

    const user = await requireUser();
    const order = await c.store.getOrder(id);
    if (!order) throw new AppError("not_found", "No such order.");
    if (order.buyerId !== user.id) throw new AppError("not_found", "No such order.");

    if (parsed.data.outcome === "paid") {
      const result = await settle(c, order.id, `mock_${order.id}`);
      return ok({
        status: result.order.status,
        claimId: result.claim?.id ?? null,
        pageSlug: result.page?.slug ?? null,
      });
    }

    const released = await release(c, order.id, "cancelled");
    return ok({ status: released.status, claimId: null, pageSlug: null });
  },
);
