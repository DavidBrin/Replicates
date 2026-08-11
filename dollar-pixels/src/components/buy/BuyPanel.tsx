"use client";

/**
 * Everything between "I have selected some blocks" and "I have paid for them".
 *
 * The panel computes the price for *display* with the same domain functions the
 * server charges with, and sends no amount of any kind — the body is a
 * rectangle and some artwork (SPEC §5). If the two ever disagree the server
 * wins, and the difference shows up as a server message in the callout rather
 * than as a wrong charge.
 *
 * There is a coordinate form as well as the canvas drag, because the accessible
 * path has to be able to buy and not merely to read (DECISIONS D16).
 */

import { useId, useState } from "react";
import {
  MAX_SELECTION_BLOCKS,
  blocksIn,
  isRectInside,
  pixelsIn,
  rectPixelSize,
  type BlockRect,
  type GridDims,
} from "@/domain/geometry";
import { formatCount, formatUsdCompact } from "@/domain/money";
import { rectPrice } from "@/domain/pricing";
import {
  CAPTION_MAX,
  SUGGESTED_COLOURS,
  artErrorMessage,
  normaliseCaption,
  normaliseColour,
  validateCaption,
  validateColour,
  validateTile,
} from "@/domain/art";
import type { User } from "@/domain/entities";
import { api, type ClaimBody } from "@/lib/api-client";
import { Button, Callout, Field, Panel } from "@/components/ui";
import { TileUploader } from "@/components/buy/TileUploader";
import { cn } from "@/lib/cn";

export interface BuyPanelProps {
  readonly slug: string;
  readonly dims: GridDims;
  readonly selection: BlockRect | null;
  readonly onSelectionChange: (rect: BlockRect | null) => void;
  readonly user: User | null;
  /** True when the viewer created this page. Gates the allowance, nothing else. */
  readonly isOwner: boolean;
  /** Only ever sent to the page's owner; null for everyone else. */
  readonly allowance: { total: number; used: number } | null;
  /** A free claim settles immediately, so the caller refetches the grid. */
  readonly onClaimed: () => void;
  /**
   * Where a started checkout sends the browser. Defaults to a full navigation
   * because under Stripe the URL is another origin entirely.
   */
  readonly onRedirect?: (url: string) => void;
  readonly className?: string;
}

const DEFAULT_COLOUR = SUGGESTED_COLOURS[0];

function defaultRedirect(url: string): void {
  window.location.href = url;
}

export function BuyPanel({
  slug,
  dims,
  selection,
  onSelectionChange,
  user,
  isOwner,
  allowance,
  onClaimed,
  onRedirect = defaultRedirect,
  className,
}: BuyPanelProps) {
  const [caption, setCaption] = useState("");
  const [colour, setColour] = useState<string>(DEFAULT_COLOUR);
  const [tile, setTile] = useState<string | null>(null);
  const [busy, setBusy] = useState<"buy" | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const blocks = selection ? blocksIn(selection) : 0;
  const priceCents = selection ? rectPrice(selection) : 0;
  const remaining = allowance ? Math.max(0, allowance.total - allowance.used) : 0;
  const canUseAllowance = Boolean(user) && isOwner && allowance !== null && remaining > 0;

  /** Validate here so an obvious mistake never costs a round trip. */
  function buildBody(): ClaimBody | null {
    if (!selection) {
      setError("Select some blocks on the grid first.");
      return null;
    }

    const cleanCaption = normaliseCaption(caption);
    const captionError = validateCaption(cleanCaption);
    if (captionError) {
      setError(artErrorMessage(captionError));
      return null;
    }

    const cleanColour = normaliseColour(colour);
    const colourError = validateColour(cleanColour);
    if (colourError) {
      setError(artErrorMessage(colourError));
      return null;
    }

    if (tile !== null) {
      const tileError = validateTile(tile, selection);
      if (tileError) {
        setError(artErrorMessage(tileError, rectPixelSize(selection)));
        return null;
      }
    }

    return { rect: selection, caption: cleanCaption, colour: cleanColour, tile };
  }

  async function buy(): Promise<void> {
    setError(null);
    setNotice(null);
    const body = buildBody();
    if (!body) return;

    setBusy("buy");
    try {
      const started = await api.buyBlocks(slug, body);
      onRedirect(started.redirectUrl);
    } catch (cause) {
      // The server's message is already written for a person to read, so it is
      // shown as it stands rather than translated into something vaguer.
      setError(cause instanceof Error ? cause.message : "Checkout could not start.");
      setBusy(null);
    }
  }

  async function claimFree(): Promise<void> {
    setError(null);
    setNotice(null);
    const body = buildBody();
    if (!body) return;

    setBusy("free");
    try {
      await api.claimFree(slug, body);
      setNotice(
        `Claimed ${formatCount(blocks)} block${blocks === 1 ? "" : "s"} from your allowance.`,
      );
      setCaption("");
      setTile(null);
      onSelectionChange(null);
      onClaimed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That claim was refused.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Buy blocks" className={cn(className)}>
      <div className="flex flex-col gap-4">
        <Summary selection={selection} blocks={blocks} priceCents={priceCents} />

        <CoordinateForm
          dims={dims}
          selection={selection}
          onSelectionChange={(rect) => {
            setError(null);
            onSelectionChange(rect);
          }}
          onInvalid={setError}
        />

        <Field
          label={`Caption (${caption.length}/${CAPTION_MAX})`}
          value={caption}
          maxLength={CAPTION_MAX}
          placeholder="What is this?"
          onChange={(event) => setCaption(event.target.value)}
          hint="Shown when someone hovers your blocks. No links — nothing here navigates off-site."
        />

        <ColourPicker value={colour} onChange={setColour} />

        {selection ? (
          <TileUploader rect={selection} value={tile} onChange={setTile} />
        ) : (
          <p className="text-xs text-(--ink-3)">
            Select some blocks to upload artwork sized to them.
          </p>
        )}

        {user ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void buy()}
                disabled={!selection || busy !== null}
                loading={busy === "buy"}
              >
                Buy for {formatUsdCompact(priceCents)}
              </Button>
              {canUseAllowance ? (
                <Button
                  variant="secondary"
                  onClick={() => void claimFree()}
                  disabled={!selection || busy !== null}
                  loading={busy === "free"}
                >
                  Use a free block
                </Button>
              ) : null}
            </div>

            {allowance !== null ? (
              <p className="tnum text-xs text-(--ink-2)">
                {formatCount(remaining)} of {formatCount(allowance.total)} free blocks
                left on this page.
              </p>
            ) : null}

            <p className="text-xs text-(--ink-3)">
              Blocks are held for 30 minutes while you pay. Nothing is written until the
              payment settles.
            </p>
          </div>
        ) : (
          <Callout>
            Sign in with a display name above to buy these blocks. There are no passwords
            and nothing is verified — anyone can sign in as any name.
          </Callout>
        )}

        {notice ? <Callout>{notice}</Callout> : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- summary -- */

function Summary({
  selection,
  blocks,
  priceCents,
}: {
  selection: BlockRect | null;
  blocks: number;
  priceCents: number;
}) {
  if (!selection) {
    return (
      <p className="text-sm text-(--ink-2)">
        Drag on the grid, or type coordinates below. A block is nine pixels and costs $1.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="tnum text-lg font-bold" data-testid="selection-summary">
        {formatCount(blocks)} block{blocks === 1 ? "" : "s"} ·{" "}
        {formatCount(pixelsIn(selection))} pixels · {formatUsdCompact(priceCents)}
      </p>
      <p className="tnum text-xs text-(--ink-2)">
        {selection.bw} × {selection.bh} blocks at {selection.bx}, {selection.by} —{" "}
        {rectPixelSize(selection).width} × {rectPixelSize(selection).height} pixels of
        artwork.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- coordinates -- */

/**
 * The pointer-free way to select.
 *
 * Four numbers rather than a second drag surface: a rectangle *is* four
 * numbers, and typing them is the one interaction that needs no canvas, no
 * pointer and no sight of the grid at all.
 */
function CoordinateForm({
  dims,
  selection,
  onSelectionChange,
  onInvalid,
}: {
  dims: GridDims;
  selection: BlockRect | null;
  onSelectionChange: (rect: BlockRect | null) => void;
  onInvalid: (message: string) => void;
}) {
  const [bx, setBx] = useState("0");
  const [by, setBy] = useState("0");
  const [bw, setBw] = useState("1");
  const [bh, setBh] = useState("1");

  function apply(): void {
    const rect: BlockRect = {
      bx: Number(bx),
      by: Number(by),
      bw: Number(bw),
      bh: Number(bh),
    };
    if (!isRectInside(rect, dims)) {
      onInvalid(
        `Those blocks are not on this grid. It is ${formatCount(dims.wBlocks)} by ${formatCount(dims.hBlocks)} blocks, counting from 0.`,
      );
      return;
    }
    if (blocksIn(rect) > MAX_SELECTION_BLOCKS) {
      onInvalid(
        `One claim covers at most ${formatCount(MAX_SELECTION_BLOCKS)} blocks.`,
      );
      return;
    }
    onSelectionChange(rect);
  }

  return (
    <details className="border border-(--rule) bg-(--panel-2) px-3 py-2">
      <summary className="cursor-pointer text-sm font-bold">
        Select by coordinates
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="X" type="number" min={0} value={bx} onChange={(e) => setBx(e.target.value)} />
          <Field label="Y" type="number" min={0} value={by} onChange={(e) => setBy(e.target.value)} />
          <Field label="Width" type="number" min={1} value={bw} onChange={(e) => setBw(e.target.value)} />
          <Field label="Height" type="number" min={1} value={bh} onChange={(e) => setBh(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={apply}>
            Set selection
          </Button>
          {selection ? (
            <Button size="sm" variant="ghost" onClick={() => onSelectionChange(null)}>
              Clear
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-(--ink-2)">
          Everything is counted in blocks, from 0. One block is three pixels square.
        </p>
      </div>
    </details>
  );
}

/* -------------------------------------------------------------- colour -- */

function ColourPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (colour: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold text-(--ink)" id={labelId}>
        Block colour
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {SUGGESTED_COLOURS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            aria-label={`Use colour ${suggestion}`}
            aria-pressed={normaliseColour(value) === suggestion}
            onClick={() => onChange(suggestion)}
            style={{ background: suggestion }}
            className={cn(
              "size-6 border",
              normaliseColour(value) === suggestion
                ? "border-(--select) outline-2 outline-(--select)"
                : "border-(--rule)",
            )}
          />
        ))}
      </div>
      <Field
        label="Or any colour"
        type="color"
        value={normaliseColour(value)}
        onChange={(event) => onChange(event.target.value)}
        hint="Used behind a tile, and on its own when there is no image."
        className="max-w-40"
      />
    </div>
  );
}
