import { getActor, getContainer } from "@/lib/container";
import { handler, ok } from "@/lib/http";

/**
 * Who am I, and is this deployment taking real money?
 *
 * The provider flag rides along here because every client screen needs it to
 * decide whether to show the play-money banner, and a second round trip for
 * one boolean would be silly.
 */
export const GET = handler(async () => {
  const [actor, c] = await Promise.all([getActor(), getContainer()]);
  return ok({
    user: actor.kind === "user" ? actor.user : null,
    payments: { id: c.payments.id, label: c.payments.label, live: c.payments.isLive },
  });
});
