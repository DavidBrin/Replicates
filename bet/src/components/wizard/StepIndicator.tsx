"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { STEP_LABELS } from "./types";

export interface StepIndicatorProps {
  /** 1-based current step. */
  currentStep: number;
  /** Highest 1-based step reached so far — a step number is only
   * clickable if it's `<= maxStepReached` (you can always jump BACK to a
   * step you've already visited and validated; you can't skip ahead of
   * "Next"). */
  maxStepReached: number;
  onSelectStep: (step: number) => void;
  className?: string;
}

/**
 * The wizard's persistent step indicator (SPEC §3.4, David's ambiguity
 * resolution: "Persistent step indicator across the top, Back/Next"). A
 * horizontal `<nav>` of five numbered steps; visited steps are clickable
 * so the wizard doubles as its own quick-nav (step 5's per-section "Edit"
 * links reuse this same jump). Client component: it owns nothing itself
 * but every affordance is a real `<button>` (G9).
 */
export function StepIndicator({
  currentStep,
  maxStepReached,
  onSelectStep,
  className,
}: StepIndicatorProps) {
  return (
    <nav aria-label="Create-bet steps" className={cn("w-full", className)}>
      <ol className="flex items-start">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = index + 1;
          const isCurrent = stepNumber === currentStep;
          const isComplete = stepNumber < currentStep;
          const isReachable = stepNumber <= maxStepReached;
          const isLast = stepNumber === STEP_LABELS.length;

          return (
            <li key={label} className={cn("flex flex-1 items-center", isLast && "flex-none")}>
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  disabled={!isReachable}
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={() => onSelectStep(stepNumber)}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium tabular-nums transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
                    isCurrent && "border-(--accent) bg-(--accent) text-(--surface-0)",
                    !isCurrent &&
                      isComplete &&
                      "border-(--accent) bg-transparent text-(--accent) hover:bg-(--accent)/15",
                    !isCurrent &&
                      !isComplete &&
                      isReachable &&
                      "border-(--border-2) text-(--text-1) hover:border-(--accent)",
                    !isReachable &&
                      "cursor-not-allowed border-(--border) text-(--text-3) disabled:opacity-100",
                  )}
                >
                  {isComplete ? <Check className="size-4" aria-hidden="true" /> : stepNumber}
                </button>
                <span
                  className={cn(
                    "text-center text-xs font-medium whitespace-nowrap",
                    isCurrent ? "text-(--text-1)" : "text-(--text-3)",
                  )}
                >
                  {label}
                </span>
              </div>
              {!isLast ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    "mx-2 mb-5 h-px flex-1",
                    isComplete ? "bg-(--accent)" : "bg-(--border)",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
