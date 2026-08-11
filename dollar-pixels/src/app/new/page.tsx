"use client";

/**
 * Make a page.
 *
 * The two kinds are priced three orders of magnitude apart, so the screen's
 * main job is explaining that the gap is the product and not a typo: $10 buys
 * a canvas, a premium page buys the revenue from one (DECISIONS D5). The
 * earn-back arithmetic is spelled out rather than asserted, because "it pays
 * for itself at half sold" is only convincing with the numbers next to it.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  PAGE_SIZE_IDS,
  PAGE_SIZES,
  gridForSize,
  totalBlocks,
  type PageSize,
} from "@/domain/geometry";
import { formatCount, formatUsd, formatUsdCompact } from "@/domain/money";
import { PRIVATE_PAGE_ALLOWANCE, pagePrice } from "@/domain/pricing";
import { slugErrorMessage, slugify, validateSlug } from "@/domain/slug";
import type { User } from "@/domain/entities";
import { api } from "@/lib/api-client";
import { Button, Callout, Field, Panel, Stat } from "@/components/ui";
import { SignInBar } from "@/components/buy";
import { cn } from "@/lib/cn";

type NewPageKind = "private" | "premium";

export default function NewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-(--ink-2)">Loading…</p>}>
      <CreateForm />
    </Suspense>
  );
}

function CreateForm() {
  const cancelled = useSearchParams().get("cancelled");

  const [user, setUser] = useState<User | null>(null);
  const [kind, setKind] = useState<NewPageKind>("private");
  const [size, setSize] = useState<PageSize>("small");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  // The answer carries the slug it was about, so a reply that arrives after the
  // field has moved on is simply not shown rather than being cleared by hand.
  const [slugState, setSlugState] = useState<{
    slug: string;
    available: boolean;
    reason: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .me()
      .then((me) => {
        if (live) setUser(me.user);
      })
      .catch(() => {
        if (live) setUser(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const effectiveSlug = slugEdited ? slug : slugify(title);
  const priceCents = pagePrice(kind, size);
  const blocks = totalBlocks(gridForSize(size));
  const localSlugError = effectiveSlug ? validateSlug(effectiveSlug) : null;
  /** The availability answer, but only while it is still about this name. */
  const checked = slugState?.slug === effectiveSlug ? slugState : null;

  // Debounced because it fires per keystroke and the answer is advisory
  // anyway — the name is only really taken when an order settles.
  useEffect(() => {
    if (!effectiveSlug || validateSlug(effectiveSlug)) return;
    let live = true;
    const handle = setTimeout(() => {
      void api
        .checkSlug(effectiveSlug)
        .then((result) => {
          if (live) setSlugState({ slug: effectiveSlug, ...result });
        })
        // A failed availability check is not worth reporting: it is advisory,
        // and the real check runs at checkout and again at settlement.
        .catch(() => undefined);
    }, 300);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [effectiveSlug]);

  async function create(): Promise<void> {
    setError(null);
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Give the page a title.");
      return;
    }
    const slugError = validateSlug(effectiveSlug);
    if (slugError) {
      setError(slugErrorMessage(slugError));
      return;
    }

    setBusy(true);
    try {
      const started = await api.createPage({
        slug: effectiveSlug,
        title: cleanTitle,
        kind,
        size,
      });
      window.location.href = started.redirectUrl;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The page could not be created.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Make a page</h1>
        <p className="max-w-2xl text-sm text-(--ink-2)">
          Your own grid, sold by the block exactly like the wall is. Pick which kind it is
          and how big it starts.
        </p>
      </header>

      {cancelled ? (
        <Callout tone="warn">
          That checkout was cancelled and nothing was charged. The name is still free —
          start again whenever you like.
        </Callout>
      ) : null}

      <SignInBar user={user} onChange={setUser} />

      <div className="grid gap-3 md:grid-cols-2">
        <KindCard
          kind="private"
          selected={kind === "private"}
          onSelect={() => setKind("private")}
        />
        <KindCard
          kind="premium"
          selected={kind === "premium"}
          onSelect={() => setKind("premium")}
        />
      </div>

      <Panel title="Size">
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="sr-only">Grid size</legend>
          <div className="flex flex-wrap gap-3">
            {PAGE_SIZE_IDS.map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 border border-(--rule) bg-(--panel-2) px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="size"
                  value={option}
                  checked={size === option}
                  onChange={() => setSize(option)}
                />
                <span className="tnum">
                  <strong className="uppercase">{option}</strong> —{" "}
                  {formatCount(PAGE_SIZES[option])} × {formatCount(PAGE_SIZES[option])}{" "}
                  blocks
                </span>
              </label>
            ))}
          </div>
          <p className="tnum text-xs text-(--ink-2)">
            {formatCount(blocks)} blocks · {formatCount(PAGE_SIZES[size] * 3)} ×{" "}
            {formatCount(PAGE_SIZES[size] * 3)} pixels · {formatUsdCompact(blocks * 100)}{" "}
            at face value.
          </p>
        </fieldset>
      </Panel>

      <Panel title="Name it">
        <div className="flex flex-col gap-3">
          <Field
            label="Title"
            value={title}
            maxLength={60}
            placeholder="Whatever it is about"
            onChange={(event) => setTitle(event.target.value)}
            hint="Up to 60 characters. Shown at the top of the page."
          />
          <Field
            label="Address"
            value={effectiveSlug}
            maxLength={32}
            placeholder="my-page"
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(slugify(event.target.value));
            }}
            hint={`It will live at /p/${effectiveSlug || "…"}`}
            error={
              localSlugError
                ? slugErrorMessage(localSlugError)
                : checked && !checked.available
                  ? checked.reason
                  : undefined
            }
          />
          {checked?.available ? (
            <p role="status" className="text-xs font-bold text-(--sold)">
              /p/{effectiveSlug} is free.
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel title="What it costs">
        <div className="flex flex-col gap-3">
          <dl className="flex flex-wrap gap-6">
            <Stat label="Page price" value={formatUsd(priceCents)} tone="money" />
            <Stat label="Blocks on it" value={formatCount(blocks)} />
            <Stat
              label="Free blocks for you"
              value={formatCount(kind === "private" ? PRIVATE_PAGE_ALLOWANCE : 0)}
            />
          </dl>

          {kind === "premium" ? (
            <Callout>
              You earn $1 of every block sold on this page. It has {formatCount(blocks)}{" "}
              blocks, so it pays for itself at {formatCount(blocks / 2)} blocks —{" "}
              {formatUsd(priceCents)} — which is half of it sold, and doubles your money if
              all of it sells. That is the whole trade: you are buying the grid at half its
              face value and the revenue from it.
            </Callout>
          ) : (
            <Callout>
              A flat {formatUsd(priceCents)} at any size, with{" "}
              {formatCount(PRIVATE_PAGE_ALLOWANCE)} free blocks to start you off. Blocks
              other people buy on it pay the platform, not you — if you want the revenue,
              that is what a premium page is.
            </Callout>
          )}

          {user ? (
            <div>
              <Button onClick={() => void create()} loading={busy} disabled={busy}>
                Create for {formatUsd(priceCents)}
              </Button>
            </div>
          ) : (
            <Callout>Sign in above to create a page. Any name will do.</Callout>
          )}

          {error ? <Callout tone="danger">{error}</Callout> : null}
        </div>
      </Panel>

      <p className="text-sm">
        <Link href="/pages">See what already exists</Link>
      </p>
    </div>
  );
}

/** The two products, described in the terms that actually differ. */
function KindCard({
  kind,
  selected,
  onSelect,
}: {
  kind: NewPageKind;
  selected: boolean;
  onSelect: () => void;
}) {
  const isPrivate = kind === "private";
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-2 border bg-(--panel) p-3 text-sm",
        selected ? "border-(--select) outline-2 outline-(--select)" : "border-(--rule)",
      )}
    >
      <span className="flex items-center gap-2 text-base font-bold">
        <input type="radio" name="kind" checked={selected} onChange={onSelect} />
        {isPrivate ? "Unlisted page" : "Premium page"}
      </span>
      {isPrivate ? (
        <>
          <p>
            {formatUsdCompact(pagePrice("private", "small"))} flat, whatever size you
            pick. Kept out of the directory and shared by its link.
          </p>
          <ul className="list-disc pl-5 text-(--ink-2)">
            <li>
              Unlisted, <strong>not</strong> private: anyone with the link sees it. No
              password, no invites, no member list.
            </li>
            <li>{formatCount(PRIVATE_PAGE_ALLOWANCE)} free blocks for you.</li>
            <li>Blocks bought on it pay the platform.</li>
          </ul>
        </>
      ) : (
        <>
          <p>
            The whole grid at half of face value — from{" "}
            {formatUsdCompact(pagePrice("premium", "small"))} to{" "}
            {formatUsdCompact(pagePrice("premium", "full"))}.
          </p>
          <ul className="list-disc pl-5 text-(--ink-2)">
            <li>Listed in the directory.</li>
            <li>
              <strong>You</strong> receive the revenue from every block sold on it.
            </li>
            <li>No free allowance — you already own the discount.</li>
          </ul>
        </>
      )}
    </label>
  );
}
