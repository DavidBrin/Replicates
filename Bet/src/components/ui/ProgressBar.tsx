import { cn } from "@/lib/cn";

export type ProgressBarTone = "accent" | "yes" | "no";

export interface ProgressBarProps {
  /** 0..1, clamped. */
  value: number;
  tone?: ProgressBarTone;
  className?: string;
  "aria-label"?: string;
}

const toneClasses: Record<ProgressBarTone, string> = {
  accent: "bg-(--accent)",
  yes: "bg-(--yes)",
  no: "bg-(--no)",
};

/** A thin, labeled progress track. Server-renderable. */
export function ProgressBar({ value, tone = "accent", className, ...props }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-(--surface-3)", className)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", toneClasses[tone])}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
