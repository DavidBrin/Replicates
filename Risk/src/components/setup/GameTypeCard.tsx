"use client";

/**
 * One `/new` game-type card (SPEC §7): ≈230×445, radius 10, a
 * `--chrome-600 → --chrome-650` gradient under a 2 px `--chrome-line` border,
 * a flat monochrome glyph in the top ~45 %, a 30 px title, a 22 px
 * description in `#E2EAEE`, and a `?` info circle top-right.
 *
 * Selected adds the olive-green fill, the glowing border, a sparkle behind
 * the glyph and the green ✓ (r 34) straddling the bottom edge.
 */
import clsx from "clsx";

import { Icon, type IconName } from "../ui/Icon";
import { SETUP_TOKENS } from "../ui/tokens";

export interface GameTypeCardProps {
  readonly title: string;
  readonly description: string;
  readonly icon: IconName;
  readonly selected: boolean;
  readonly onSelect: () => void;
  /** The `?` info circle; omitted, the circle is still drawn but inert. */
  readonly onInfo?: () => void;
  readonly testId: string;
}

export function GameTypeCard({
  title,
  description,
  icon,
  selected,
  onSelect,
  onInfo,
  testId,
}: GameTypeCardProps) {
  return (
    <div className="relative" style={{ width: "min(230px, 30vw)" }}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-testid={testId}
        data-selected={selected ? "true" : "false"}
        onClick={onSelect}
        className={clsx(
          "flex w-full cursor-pointer flex-col items-center outline-none",
          "focus-visible:ring-4 focus-visible:ring-white/70",
        )}
        style={{
          height: "min(445px, 58vh)",
          minHeight: 260,
          borderRadius: "var(--r-menu)",
          background: selected
            ? "linear-gradient(#6E7F2E, #46551C)"
            : "linear-gradient(var(--chrome-600), var(--chrome-650))",
          border: `2px solid ${selected ? "var(--go)" : "var(--chrome-line)"}`,
          boxShadow: selected ? "0 0 22px var(--go)" : "var(--sh-panel)",
          transition: "background 200ms ease-out, box-shadow 200ms ease-out",
        }}
      >
        {/* glyph, top ~45% — with the selected sparkle behind it */}
        <span className="relative flex h-[45%] w-full items-center justify-center">
          {selected ? (
            <span
              aria-hidden
              data-testid={`${testId}-sparkle`}
              className="pointer-events-none absolute inset-0"
              style={{
                background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,.35) 0%, transparent 62%)",
              }}
            />
          ) : null}
          <span className="relative" style={{ color: "var(--text)" }}>
            <Icon name={icon} size={92} />
          </span>
        </span>

        <span
          className="on-board-text px-2 text-center"
          style={{ fontSize: "clamp(18px, 2.4vw, 30px)" }}
        >
          {title}
        </span>

        <span
          className="mt-3 px-3 text-center font-body"
          style={{ fontSize: "clamp(14px, 1.8vw, 22px)", color: SETUP_TOKENS.cardDescription }}
        >
          {description}
        </span>
      </button>

      {/* the `?` info circle, top-right */}
      <button
        type="button"
        data-testid={`${testId}-info`}
        aria-label={`About ${title}`}
        onClick={onInfo}
        className="absolute right-1 top-1 flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        style={{
          width: 44,
          height: 44,
          background: "transparent",
          color: "var(--text)",
          opacity: 0.85,
        }}
      >
        <Icon name="question" size={20} />
      </button>

      {/* the green ✓ (r 34) straddling the bottom edge */}
      {selected ? (
        <span
          data-testid={`${testId}-check`}
          aria-hidden
          className="absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full"
          style={{
            width: 68,
            height: 68,
            bottom: -34,
            background: "linear-gradient(var(--go), var(--go-mid))",
            border: "3px solid var(--go-deep)",
            color: "var(--text)",
          }}
        >
          <Icon name="check" size={34} />
        </span>
      ) : null}
    </div>
  );
}

export default GameTypeCard;
