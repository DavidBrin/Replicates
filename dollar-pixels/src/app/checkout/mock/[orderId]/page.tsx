"use client";

/**
 * The fake-money checkout.
 *
 * It is not a shortcut past settlement — pressing Pay calls the same
 * `fulfilment.settle` a Stripe webhook calls, with the same arguments
 * (DECISIONS D10). That is what makes every play-money purchase a test of the
 * code that will run when the money is real, and it is why this screen has a
 * decline button as well as a pay button: the failure path deserves to be
 * exercised as often as the happy one.
 *
 * Under Stripe the endpoint behind these buttons returns 404, because the
 * fake-money route does not exist in a real deployment. The screen says so
 * rather than showing three buttons that cannot work.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { formatUsd } from "@/domain/money";
import { api, type OrderView } from "@/lib/api-client";
import { Button, Callout, Panel, Spinner, Stat } from "@/components/ui";

type Outcome = "paid" | "declined" | "cancelled";

export default function MockCheckout() {
  const router = useRouter();
  const params = useParams();
  const orderId = typeof params.orderId === "string" ? params.orderId : "";

  const [order, setOrder] = useState<OrderView | null>(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // `me` comes along because whether this screen may exist at all is a
    // property of the deployment, not of the order.
    void Promise.all([api.me(), api.order(orderId)])
      .then(([me, found]) => {
        if (!live) return;
        setLive(me.payments.live);
        setOrder(found);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(
          cause instanceof Error ? cause.message : "That order could not be loaded.",
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [orderId]);

  async function settle(outcome: Outcome): Promise<void> {
    setError(null);
    setBusy(outcome);
    try {
      await api.mockSettle(orderId, outcome);
      router.push(`/checkout/return?order=${encodeURIComponent(orderId)}`);
    } catch (cause) {
      // The order loaded a moment ago, so a 404 from here is the provider
      // switch and not a missing order.
      setError(
        cause instanceof Error ? cause.message : "That could not be recorded.",
      );
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-(--ink-2)">
        <Spinner label="Loading the order" /> Loading the order…
      </p>
    );
  }

  if (live) {
    return (
      <Panel title="Play-money checkout is switched off">
        <div className="flex flex-col gap-2 text-sm">
          <p>
            This deployment takes real payments, so there is no fake checkout to show. The
            route behind this page does not exist here at all.
          </p>
          <p>
            If you arrived by following an old link, start the purchase again from the
            page you were buying on.
          </p>
          <p>
            <Link href="/">Back to the start</Link>
          </p>
        </div>
      </Panel>
    );
  }

  if (!order) {
    return (
      <Panel title="No such order">
        <div className="flex flex-col gap-2 text-sm">
          <p>{error ?? "That order does not exist, or it is not yours."}</p>
          <p>
            <Link href="/dashboard">Your orders</Link>
          </p>
        </div>
      </Panel>
    );
  }

  const settled = order.status !== "pending";

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Checkout</h1>

      <Callout tone="danger">
        <strong className="uppercase">This is play money.</strong> No card is charged, no
        payment details are asked for, and nothing here reaches a bank. The buttons below
        simply tell the site what to pretend happened.
      </Callout>

      <Panel title="What you are buying">
        <div className="flex flex-col gap-3">
          <dl className="flex flex-wrap gap-6">
            <Stat label="Amount" value={formatUsd(order.amountCents)} tone="money" />
            <Stat label="For" value={order.kind === "page" ? "A new page" : "Blocks"} />
            <Stat label="Status" value={order.status} />
          </dl>
          {order.pageSlug ? (
            <p className="text-sm">
              On <Link href={`/p/${order.pageSlug}`}>/p/{order.pageSlug}</Link>
            </p>
          ) : null}
          <p className="text-xs text-(--ink-2)">
            The amount was computed by the server from what you selected. Nothing on this
            screen can change it.
          </p>
        </div>
      </Panel>

      {settled ? (
        <Callout>
          This order is already {order.status}. There is nothing left to decide.{" "}
          <Link href={`/checkout/return?order=${encodeURIComponent(order.id)}`}>
            See what happened
          </Link>
          .
        </Callout>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void settle("paid")} loading={busy === "paid"} disabled={busy !== null}>
            Pay {formatUsd(order.amountCents)}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void settle("declined")}
            loading={busy === "declined"}
            disabled={busy !== null}
          >
            Simulate a decline
          </Button>
          <Button
            variant="ghost"
            onClick={() => void settle("cancelled")}
            loading={busy === "cancelled"}
            disabled={busy !== null}
          >
            Cancel
          </Button>
        </div>
      )}

      <p className="text-xs text-(--ink-2)">
        Declining and cancelling both release the blocks this order was holding, so
        somebody else can buy them straight away.
      </p>

      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  );
}
