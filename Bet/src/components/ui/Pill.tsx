import { formatProbability } from "@/domain/formatters";
import { cn } from "@/lib/cn";

export type PillTone = "auto" | "yes" | "no" | "neutral";

export interface PillProps {
  /** Probability, 0..1. Always rendered as a whole-percent numeral — a
   * probability is never conveyed by color alone (G9, SPEC §7.4). */
  value: number;
  /** `"auto"` (default) picks yes-green above 0.5 and neutral at/below it. */
  tone?: PillTone;
  /** The leading outcome's pill is always emphasized (SPEC §5.1). */
  emphasis?: boolean;
  className?: string;
}

const toneClasses: Record<Exclude<PillTone, "auto">, string> = {
  // --yes-br / --no-br are pre-mixed at exactly 32% alpha (SPEC §7.1) — used
  // directly rather than an opacity modifier so the border color is exact.
  yes: "border-(--yes-br) text-(--yes)",
  no: "border-(--no-br) text-(--no)",
  neutral: "border-(--text-2)/32 text-(--text-2)",
};

const emphasisBg: Record<Exclude<PillTone, "auto">, string> = {
  yes: "bg-(--yes-bg)",
  no: "bg-(--no-bg)",
  neutral: "bg-(--text-2)/10",
};

function resolveTone(tone: PillTone, value: number): Exclude<PillTone, "auto"> {
  if (tone !== "auto") return tone;
  return value > 0.5 ? "yes" : "neutral";
}

/**
 * The outlined probability chip (SPEC §5.1, §7.1): transparent fill, 1px
 * border at 32% alpha, solid text, pill radius, tabular numerals. The
 * single most-used component in the app. Server-renderable.
 */
export function Pill({ value, tone = "auto", emphasis = false, className }: PillProps) {
  const resolved = resolveTone(tone, value);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-(--radius-pill) border bg-transparent px-[10px] py-[2px] text-[13px] tabular-nums",
        emphasis ? "font-semibold" : "font-medium",
        toneClasses[resolved],
        emphasis && emphasisBg[resolved],
        className,
      )}
    >
      {formatProbability(value)}
    </span>
  );
}
