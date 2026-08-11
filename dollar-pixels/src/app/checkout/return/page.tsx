"use client";

/**
 * Where both providers land after a payment.
 *
 * The order is not paid when the buyer gets here — it is paid when the
 * provider's confirmation reaches the server, which for Stripe is a webhook
 * racing this redirect and arriving out of order (DECISIONS D17). So this
 * screen polls rather than asserting, and gives up saying "we do not know
 * yet, look at your orders" instead of guessing.
 *
 * `useSearchParams` needs a Suspense boundary above it or the build fails, and
 * the boundary is real: the order id genuinely is not known until the client
 * reads the URL.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { formatUsd } from "@/domain/money";
import { api, type OrderView } from "@/lib/api-client";
import { Callout, Panel, Spinner, Stat } from "@/components/ui";

/** One second between polls, thirty seconds before we stop asking. */
const POLL_MS = 1_000;
const GIVE_UP_MS = 30_000;

export default function CheckoutReturn() {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 text-sm text-(--ink-2)">
          <Spinner label="Loading" /> Loading…
        </p>
      }
    >
      <ReturnView />
    </Suspense>
  );
}

function ReturnView() {
  const orderId = useSearchParams().get("order") ?? "";

  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async (): Promise<void> => {
      try {
        const found = await api.order(orderId);
        if (!live) return;
        setOrder(found);
        if (found.status !== "pending") return;
      } catch (cause) {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : "Could not read that order.");
        return;
      }
      if (Date.now() - startedAt >= GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };

    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  if (!orderId) {
    return (
      <Panel title="Nothing to show">
        <p className="text-sm">
          This page needs an order to report on. <Link href="/dashboard">Your orders</Link>{" "}
          lists everything you have bought.
        </p>
      </Panel>
    );
  }

  const status = order?.status ?? "pending";
  const pageHref = order?.pageSlug ? `/p/${order.pageSlug}` : null;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Your order</h1>

      {order ? (
        <Panel>
          <dl className="flex flex-wrap gap-6">
            <Stat label="Amount" value={formatUsd(order.amountCents)} tone="money" />
            <Stat label="For" value={order.kind === "page" ? "A new page" : "Blocks"} />
            <Stat
              label="Status"
              value={status}
              tone={status === "paid" ? "sold" : status === "pending" ? "neutral" : "open"}
            />
          </dl>
        </Panel>
      ) : null}

      <div aria-live="polite">
        {error ? (
          <Callout tone="danger">{error}</Callout>
        ) : status === "paid" ? (
          <Callout>
            <strong>Paid.</strong>{" "}
            {order?.kind === "page"
              ? "Your page exists and is ready to be filled."
              : "Your blocks are yours and the artwork is on the grid."}{" "}
            {pageHref ? <Link href={pageHref}>Go and see it</Link> : null}
          </Callout>
        ) : status === "cancelled" || status === "expired" ? (
          <Callout tone="warn">
            This order was {status}, and nothing was charged. Any blocks it was holding are
            back on sale.{" "}
            {pageHref ? <Link href={pageHref}>Try again on the page</Link> : null}
          </Callout>
        ) : gaveUp ? (
          <Callout tone="warn">
            Still waiting for the payment to be confirmed. That is not a failure — a
            confirmation can arrive a minute late — but there is nothing more to watch
            here. <Link href="/dashboard">Your orders</Link> shows the answer when it
            lands.
          </Callout>
        ) : (
          <p className="flex items-center gap-2 text-sm text-(--ink-2)">
            <Spinner label="Waiting for the payment to settle" /> Waiting for the payment
            to be confirmed…
          </p>
        )}
      </div>

      <p className="text-sm">
        <Link href="/dashboard">Your dashboard</Link> ·{" "}
        <Link href="/p/the-wall">The wall</Link>
      </p>
    </div>
  );
}
