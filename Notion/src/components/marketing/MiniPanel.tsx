/**
 * A tiny declarative renderer for the illustrative panels beside each feature.
 *
 * Ten bespoke mock components would be ten places to drift; instead every
 * panel is described as a short list of rows and rendered by one component.
 * Purely presentational — no state, no interaction, safe on the server.
 */

export type Tone = "blue" | "gray" | "green" | "amber" | "red";

export const TONES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  blue: { bg: "var(--mkt-blue-200)", fg: "var(--mkt-blue-700)", dot: "#097FE8" },
  gray: { bg: "var(--mkt-gray-200)", fg: "var(--mkt-gray-600)", dot: "#A39E98" },
  green: { bg: "#E8F1EC", fg: "#2A533C", dot: "#448361" },
  amber: { bg: "#F9F3DC", fg: "#655121", dot: "#CB912F" },
  red: { bg: "#FCE9E7", fg: "#6D3531", dot: "#CD3C3A" },
};

export type PanelRow =
  | { kind: "text"; text: string; muted?: boolean }
  | { kind: "bubble"; text: string; side: "left" | "right" }
  | { kind: "task"; text: string; done?: boolean }
  | { kind: "row"; text: string; chip?: string; tone?: Tone; meta?: string }
  | { kind: "bar"; label: string; value: number; tone?: Tone }
  | { kind: "chips"; items: { text: string; tone?: Tone }[] }
  | { kind: "divider" };

export interface MiniPanelProps {
  title: string;
  subtitle?: string;
  rows: PanelRow[];
}

export function MiniPanel({ title, subtitle, rows }: MiniPanelProps) {
  return (
    <div
      className="mkt-card overflow-hidden"
      style={{ boxShadow: "var(--shadow-200)" }}
    >
      {/* panel header */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--mkt-border-base)" }}
      >
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: "var(--mkt-blue-500)" }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p
            className="truncate text-[14px] leading-5 font-semibold"
            style={{ color: "var(--mkt-text-strong)" }}
          >
            {title}
          </p>
          {subtitle && (
            <p
              className="truncate text-[12px] leading-4"
              style={{ color: "var(--mkt-text-muted)" }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-4">
        {rows.map((row, i) => (
          <Row key={i} row={row} />
        ))}
      </div>
    </div>
  );
}

function Row({ row }: { row: PanelRow }) {
  switch (row.kind) {
    case "text":
      return (
        <p
          className="text-[13px] leading-5"
          style={{
            color: row.muted ? "var(--mkt-text-muted)" : "var(--mkt-gray-800)",
          }}
        >
          {row.text}
        </p>
      );

    case "bubble":
      return (
        <div
          className={
            row.side === "right" ? "flex justify-end" : "flex justify-start"
          }
        >
          <span
            className="max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-5"
            style={
              row.side === "right"
                ? { background: "var(--mkt-blue-600)", color: "#fff" }
                : {
                    background: "var(--mkt-gray-200)",
                    color: "var(--mkt-gray-800)",
                  }
            }
          >
            {row.text}
          </span>
        </div>
      );

    case "task":
      return (
        <div className="flex items-center gap-2">
          <span
            className="grid size-4 shrink-0 place-items-center rounded-[4px]"
            style={{
              background: row.done ? "var(--mkt-blue-600)" : "#fff",
              border: row.done
                ? "1px solid var(--mkt-blue-600)"
                : "1px solid var(--mkt-gray-300)",
            }}
            aria-hidden="true"
          >
            {row.done && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="m2 5.2 2 2 4-4.4"
                  stroke="#fff"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
          <span
            className="text-[13px] leading-5"
            style={{
              color: row.done ? "var(--mkt-text-muted)" : "var(--mkt-gray-800)",
              textDecoration: row.done ? "line-through" : undefined,
            }}
          >
            {row.text}
          </span>
        </div>
      );

    case "row": {
      const tone = TONES[row.tone ?? "gray"];
      return (
        <div
          className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5"
          style={{ background: "var(--mkt-gray-100)" }}
        >
          <span
            className="min-w-0 truncate text-[13px] leading-5"
            style={{ color: "var(--mkt-gray-800)" }}
          >
            {row.text}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {row.meta && (
              <span
                className="text-[11px]"
                style={{ color: "var(--mkt-text-muted)" }}
              >
                {row.meta}
              </span>
            )}
            {row.chip && (
              <span
                className="mkt-chip"
                style={{ background: tone.bg, color: tone.fg }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: tone.dot }}
                />
                {row.chip}
              </span>
            )}
          </span>
        </div>
      );
    }

    case "bar": {
      const tone = TONES[row.tone ?? "blue"];
      return (
        <div className="flex items-center gap-3">
          <span
            className="w-[86px] shrink-0 truncate text-[12px]"
            style={{ color: "var(--mkt-text-muted)" }}
          >
            {row.label}
          </span>
          <span
            className="h-2 flex-1 overflow-hidden rounded-full"
            style={{ background: "var(--mkt-gray-200)" }}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, row.value))}%`,
                background: tone.dot,
              }}
            />
          </span>
          <span
            className="w-8 shrink-0 text-right text-[12px] tabular-nums"
            style={{ color: "var(--mkt-gray-700)" }}
          >
            {row.value}%
          </span>
        </div>
      );
    }

    case "chips":
      return (
        <div className="flex flex-wrap gap-1.5">
          {row.items.map((item) => {
            const tone = TONES[item.tone ?? "gray"];
            return (
              <span
                key={item.text}
                className="mkt-chip"
                style={{ background: tone.bg, color: tone.fg }}
              >
                {item.text}
              </span>
            );
          })}
        </div>
      );

    case "divider":
      return (
        <hr
          className="my-1"
          style={{ borderTop: "1px solid var(--mkt-border-base)" }}
        />
      );
  }
}
