"use client";

import { useEffect, type ReactNode } from "react";
import clsx from "clsx";

import { PixelButton } from "./PixelButton";

/**
 * The amber modal of the Strength chart (`wt-0215`): khaki frame, warm-black
 * outline, a centred "- Title -" heading and a green OK. Closes on Escape,
 * backdrop tap, or the OK button. Used by settings, pause, help and the
 * victory/defeat screens.
 */
export interface PixelDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Label of the confirm button; `null` hides it. */
  okLabel?: string | null;
  className?: string;
}

export function PixelDialog({ open, title, onClose, children, okLabel = "OK", className }: PixelDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ie-dialog-backdrop" onClick={onClose} data-testid="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx("ie-dialog p-4", className)}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="ie-caps mb-3 text-center text-lg" style={{ color: "#fff", textShadow: "var(--ie-text-outline)" }}>
          - {title} -
        </h2>
        <div>{children}</div>
        {okLabel !== null && (
          <div className="mt-4">
            <PixelButton variant="green" block onClick={onClose}>
              {okLabel}
            </PixelButton>
          </div>
        )}
      </div>
    </div>
  );
}

export default PixelDialog;
