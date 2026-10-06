"use client";

/**
 * The card-trade panel (SPEC §7.2, §3.3).
 *
 * Board scrim, a red ✗ on a grey tray at (75, 512), a shallow fan of 175×320
 * cards across y 110–430, the bonus legend panel x 1320–1565 / y 150–490 with
 * its four published rows, and the green `Trade In Now +N` pill at (795, 530).
 *
 * **A forced trade is the same panel with the ✗ removed.** When nothing can be
 * traded the pill is the disabled `No Matching Cards`.
 */

import { IconButton } from "@/components/ui/IconButton";
import { NotchedRing } from "@/components/ui/NotchedRing";
import { Pill } from "@/components/ui/Pill";
import { Tray } from "@/components/ui/Tray";
import type { Card, PlayerColour } from "@/engine/types";

import { at, atTopLeft, outlined, Stage } from "./stage";
import { TerritoryCard } from "./TerritoryCard";

/** The published legend, in order. The numbers are the fixed set values (R22). */
const BONUS_ROWS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 4, label: "Infantry" },
  { value: 6, label: "Cavalry" },
  { value: 8, label: "Artillery" },
  { value: 10, label: "All Three" },
];

export interface CardTradePanelProps {
  readonly cards: readonly Card[];
  /** Every set that can legally be traded right now, as `Card.id` triples. */
  readonly sets: readonly (readonly [string, string, string])[];
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
  /** The live value of the current set — the `+N` on the pill. */
  readonly value: number;
  readonly scheme: "fixed" | "progressive";
  /** The held territory that takes the +2 (R23), or null. */
  readonly bonusTerritoryName: string | null;
  /** A forced trade: the same panel with the ✗ removed. */
  readonly forced: boolean;
  readonly onTrade: () => void;
  readonly onClose: () => void;
  /** Current owner per card id, for the owner-tinted silhouette (§8). */
  readonly owners?: Readonly<Record<string, PlayerColour>>;
}

/** ±4–6° alternating, the middle card upright (§7.2). */
function fanAngle(index: number, count: number): number {
  const middle = (count - 1) / 2;
  const offset = index - middle;
  if (Math.abs(offset) < 0.001) return 0;
  return Math.sign(offset) * (4 + (Math.abs(offset) - 1) * 2);
}

export function CardTradePanel({
  cards, sets, selected, onToggle, value, scheme, bonusTerritoryName, forced,
  onTrade, onClose, owners,
}: CardTradePanelProps) {
  const hasSet = sets.length > 0;
  const chosen = sets.some((set) => set.every((id) => selected.includes(id)))
    && selected.length === 3;
  const label = hasSet ? `Trade In Now +${value}` : "No Matching Cards";

  return (
    <Stage testId="card-trade-panel" label="Cards" z="var(--z-modal)">
      <div style={{ ...at(800, 55), ...outlined(50, 900) }}>Cards</div>

      {forced ? null : (
        <div style={at(75, 512)}>
          <Tray testId="card-trade-close-tray">
            <IconButton chassis="circle" tone="danger" icon="cross" size={68}
              label="Close cards" onClick={onClose} testId="card-trade-close" />
          </Tray>
        </div>
      )}

      {/* the shallow fan, y 110–430 */}
      <div
        data-testid="card-fan"
        style={{ ...atTopLeft(0, 110), width: "100%", height: 320, display: "flex",
          alignItems: "flex-start", justifyContent: "center" }}
      >
        {cards.map((card, i) => (
          <TerritoryCard
            key={card.id}
            card={card}
            selected={selected.includes(card.id)}
            onToggle={onToggle}
            owner={owners?.[card.id]}
            rotate={fanAngle(i, cards.length)}
          />
        ))}
      </div>

      {/* bonus legend, x 1320–1565, y 150–490 */}
      <div
        data-testid="bonus-legend"
        style={{
          ...atTopLeft(1320, 150),
          width: 245,
          height: 340,
          background: "color-mix(in srgb, var(--chrome-800) 92%, transparent)",
          borderRadius: 12,
          /* §7.2 quotes this stroke literally; it has no token. */
          border: "2px solid #243640",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span
          style={{
            alignSelf: "center", background: "var(--brand-red)", color: "var(--text)",
            borderRadius: 10, padding: "4px 26px", fontFamily: "var(--font-head), system-ui",
            fontWeight: 700, fontSize: 26,
          }}
        >
          Bonus
        </span>
        {BONUS_ROWS.map((row) => {
          const ringed = row.value === value;
          return (
            <div
              key={row.label}
              data-testid={`bonus-row-${row.value}`}
              data-ringed={ringed ? "true" : "false"}
              style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 54 }}
            >
              {ringed ? (
                <span style={{ width: 54, display: "grid", placeItems: "center" }}>
                  <NotchedRing value={row.value} radius={23} stroke={5}
                    testId={`bonus-ring-${row.value}`} />
                </span>
              ) : (
                <span style={{ width: 54, textAlign: "center", fontFamily: "var(--font-head)",
                  fontWeight: 900, fontSize: 34, color: "var(--text)" }}>
                  {row.value}
                </span>
              )}{" "}
              <span style={{ fontFamily: "var(--font-body), system-ui", fontSize: 26,
                /* §7.2 quotes this label grey literally. */ color: "#D4DBDF" }}>
                {row.label}
              </span>
            </div>
          );
        })}
      </div>

      {bonusTerritoryName === null ? null : (
        <div
          data-testid="card-bonus-territory"
          style={{ ...at(795, 478), fontFamily: "var(--font-body), system-ui", fontSize: 24,
            color: "var(--text-muted)", whiteSpace: "nowrap" }}
        >
          +2 to {bonusTerritoryName}
        </div>
      )}

      <div style={at(795, 530)} data-scheme={scheme}>
        <Pill
          variant={hasSet ? "primary" : "disabled"}
          size="hero"
          disabled={!hasSet || !chosen}
          label={label}
          onClick={onTrade}
          testId="trade-in-now"
        />
      </div>
    </Stage>
  );
}

export default CardTradePanel;
