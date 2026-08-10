import { formatPriceCents } from "@/domain/formatters";
import { Badge } from "@/components/ui/Badge";
import { synthesizeOrderBook } from "./orderbook-synth";

export interface OrderBookDepthProps {
  marketId: string;
  midPrice: number;
}

/** Display-only order-book depth table (SPEC §3.6: "synthesize plausible
 * bids/asks around the current price — label it clearly as illustrative").
 * Explore has no real matching engine behind it, so this is explicitly
 * flagged, not presented as live data. Server-renderable. */
export function OrderBookDepth({ marketId, midPrice }: OrderBookDepthProps) {
  const book = synthesizeOrderBook(marketId, midPrice);
  const asksNearToFar = [...book.asks].reverse();
  const maxSize = Math.max(1, ...book.bids.map((l) => l.size), ...book.asks.map((l) => l.size));

  return (
    <section aria-labelledby="orderbook-heading">
      <div className="mb-1 flex items-center gap-2">
        <h2 id="orderbook-heading" className="text-sm font-semibold text-(--text-1)">
          Order book depth
        </h2>
        <Badge tone="warn">Illustrative</Badge>
      </div>
      <p className="mb-3 text-xs text-(--text-3)">
        Explore has no live matching engine — this ladder is synthesized around the
        current price to show what depth would look like. It is not real resting orders.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1 flex justify-between text-xs font-medium text-(--yes)">
            <span>Bids</span>
            <span>Size</span>
          </div>
          <ul className="flex flex-col gap-1">
            {book.bids.map((level, i) => (
              <li key={i} className="relative overflow-hidden rounded-(--radius-input)">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 bg-(--yes-bg)"
                  style={{ width: `${(level.size / maxSize) * 100}%` }}
                />
                <span className="relative z-10 flex items-center justify-between px-2 py-1 text-xs">
                  <span className="tabular-nums text-(--text-1)">{formatPriceCents(level.price)}</span>
                  <span className="tabular-nums text-(--text-3)">{Math.round(level.size)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs font-medium text-(--no)">
            <span>Asks</span>
            <span>Size</span>
          </div>
          <ul className="flex flex-col gap-1">
            {asksNearToFar.map((level, i) => (
              <li key={i} className="relative overflow-hidden rounded-(--radius-input)">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 bg-(--no-bg)"
                  style={{ width: `${(level.size / maxSize) * 100}%` }}
                />
                <span className="relative z-10 flex items-center justify-between px-2 py-1 text-xs">
                  <span className="tabular-nums text-(--text-1)">{formatPriceCents(level.price)}</span>
                  <span className="tabular-nums text-(--text-3)">{Math.round(level.size)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
