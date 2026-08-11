"use client";

/**
 * What you own, what you bought, and what you are owed.
 *
 * The earnings figure is the one that needs qualifying every time it appears:
 * it is a ledger balance and nothing more. No money moves out of this system —
 * paying creators means Stripe Connect, onboarding and a regulatory surface
 * that is deliberately out of scope (DECISIONS D12) — and a dashboard that
 * showed a balance without saying so would be implying a payout that is not
 * coming.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { blocksIn } from "@/domain/geometry";
import { formatCount, formatUsd, formatUsdCompact } from "@/domain/money";
import { rectPrice } from "@/domain/pricing";
import type { User } from "@/domain/entities";
import { api, type DashboardView } from "@/lib/api-client";
import { Badge, Callout, Panel, Spinner, Stat } from "@/components/ui";
import { SignInBar } from "@/components/buy";

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<DashboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Signing in or out changes who the dashboard is for, so the bar bumps this
  // and the effect below reloads. The dashboard route is the authority on
  // whether there is a session at all — `me` is only how the bar knows what to
  // render.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    void api
      .me()
      .then(async (me) => {
        if (!live) return;
        setUser(me.user);
        setView(me.user ? await api.dashboard() : null);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setView(null);
        setError(
          cause instanceof Error ? cause.message : "Could not load your dashboard.",
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <SignInBar
        user={user}
        onChange={(next) => {
          setUser(next);
          setLoading(true);
          setReloadKey((key) => key + 1);
        }}
      />

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-(--ink-2)">
          <Spinner label="Loading your dashboard" /> Loading…
        </p>
      ) : null}

      {!loading && !user ? (
        <Callout>
          Sign in above to see your pages, your blocks and your earnings. The name is the
          whole of the account — sign in with the same one to find your things again, and
          note that nothing stops someone else using it.
        </Callout>
      ) : null}

      {error ? <Callout tone="danger">{error}</Callout> : null}

      {view ? (
        <>
          <Panel title="Earnings">
            <div className="flex flex-col gap-3">
              <dl className="flex flex-wrap gap-6">
                <Stat
                  label="Balance"
                  value={formatUsd(view.earnings.balanceCents)}
                  tone="money"
                />
                <Stat label="Ledger entries" value={formatCount(view.earnings.entries.length)} />
              </dl>

              <Callout tone="warn">
                This balance is a record of what you are owed, not money you can withdraw.
                Nothing pays out: there is no payout account, no transfer and no schedule,
                and there will not be one until real creator payments are built.
              </Callout>

              {view.earnings.entries.length === 0 ? (
                <p className="text-sm text-(--ink-2)">
                  Nothing yet. A premium page credits you a dollar for every block someone
                  buys on it.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <caption className="pb-2 text-left text-xs text-(--ink-2)">
                      Every entry, newest last. Entries are only ever added.
                    </caption>
                    <thead>
                      <tr className="border-b border-(--rule) text-left">
                        <th scope="col" className="py-1 pr-3">
                          When
                        </th>
                        <th scope="col" className="py-1 pr-3">
                          What
                        </th>
                        <th scope="col" className="py-1">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.earnings.entries.map((entry) => (
                        <tr key={entry.id} className="border-b border-(--rule)/30">
                          <td className="tnum py-1 pr-3">{shortDate(entry.createdAt)}</td>
                          <td className="py-1 pr-3">{entry.kind.replace(/_/g, " ")}</td>
                          <td className="tnum py-1">{formatUsd(entry.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Your pages">
            {view.pages.length === 0 ? (
              <p className="text-sm text-(--ink-2)">
                None yet. <Link href="/new">Make one</Link> — unlisted for $10, or premium
                if you want the block revenue.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {view.pages.map((page) => (
                  <li key={page.slug} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/p/${page.slug}`} className="font-bold">
                      {page.title}
                    </Link>
                    <Badge tone={page.kind === "premium" ? "premium" : "private"}>
                      {page.kind}
                    </Badge>
                    <span className="tnum text-(--ink-2)">
                      {formatCount(page.soldBlocks)} blocks sold
                      {page.allowanceTotal > 0
                        ? ` · ${formatCount(page.allowanceTotal - page.allowanceUsed)} of ${formatCount(page.allowanceTotal)} free blocks left`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Your blocks">
            {view.claims.length === 0 ? (
              <p className="text-sm text-(--ink-2)">
                You have not bought any blocks yet.{" "}
                <Link href="/p/the-wall">The wall</Link> is the place to start.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {view.claims.map((claim) => (
                  <li key={claim.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      aria-hidden="true"
                      style={{ background: claim.colour }}
                      className="inline-block size-3 border border-(--rule)"
                    />
                    <strong>{claim.caption}</strong>
                    <span className="tnum text-(--ink-2)">
                      {formatCount(blocksIn(claim.rect))} blocks at {claim.rect.bx},{" "}
                      {claim.rect.by} · {formatUsdCompact(rectPrice(claim.rect))}
                    </span>
                    {claim.pageSlug ? (
                      <Link href={`/p/${claim.pageSlug}`}>on /p/{claim.pageSlug}</Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Your orders">
            {view.orders.length === 0 ? (
              <p className="text-sm text-(--ink-2)">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="pb-2 text-left text-xs text-(--ink-2)">
                    Free blocks appear here at $0 — they are ordinary orders that cost
                    nothing, which is also the audit trail for an allowance.
                  </caption>
                  <thead>
                    <tr className="border-b border-(--rule) text-left">
                      <th scope="col" className="py-1 pr-3">
                        When
                      </th>
                      <th scope="col" className="py-1 pr-3">
                        For
                      </th>
                      <th scope="col" className="py-1 pr-3">
                        Status
                      </th>
                      <th scope="col" className="py-1">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.orders.map((order) => (
                      <tr key={order.id} className="border-b border-(--rule)/30">
                        <td className="tnum py-1 pr-3">{shortDate(order.createdAt)}</td>
                        <td className="py-1 pr-3">{order.kind}</td>
                        <td className="py-1 pr-3">{order.status}</td>
                        <td className="tnum py-1">{formatUsd(order.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

/** ISO instants are unreadable; the date is all anyone needs from an order row. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}
