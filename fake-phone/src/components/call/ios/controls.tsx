/**
 * The three button shapes the iOS call screen uses, and nothing else.
 *
 * They are split out because the *material* is the fidelity requirement, not
 * the layout: the frosted grid button and its inverted-on state are the detail
 * replicas most often miss (research/ios-call-ui.md §7.3), so the state lives in
 * one component that both screens share rather than in a class string copied
 * twice.
 */

import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * `.ultraThinMaterial` over a dark backdrop, as close as CSS gets:
 * `rgba(255,255,255,0.16)` over `blur(20px) saturate(180%)`
 * (research/ios-call-ui.md §3 "Materials").
 */
const GLASS = "bg-white/16 text-white backdrop-blur-[20px] backdrop-saturate-[180%]";

/**
 * The inversion. Toggled controls go solid white with a dark glyph — the same
 * "selected" pattern iOS uses for the keyboard shift key and Control Centre, and
 * the affordance a real user reads to check that mute is actually on
 * (research/ios-call-ui.md §2.3).
 */
const GLASS_ON = "bg-white text-black";

export interface GlassControlProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
  /** Omitted for the three controls this app has no state for; see below. */
  readonly onClick?: () => void;
}

/**
 * One cell of the 3×2 grid: ~72pt circle (research/ios-call-ui.md §2.3).
 *
 * Add-call, FaceTime and Contacts exist on the real screen but have nothing to
 * do here, and a button that silently does nothing is worse than no button
 * under stress — so without a handler the cell renders as inert, aria-hidden
 * chrome that still holds the grid's shape.
 */
export function GlassControl({
  label,
  icon,
  active = false,
  disabled = false,
  testId,
  onClick,
}: GlassControlProps) {
  const shape = clsx(
    "flex h-[72px] w-[72px] items-center justify-center rounded-full",
    "transition-[background-color,color,transform] duration-150 ease-ios",
    active ? GLASS_ON : GLASS,
  );

  if (!onClick) {
    return (
      <div aria-hidden="true" className={shape}>
        {icon}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={clsx(shape, "active:scale-[0.96] disabled:opacity-60")}
    >
      {icon}
    </button>
  );
}

export interface CircleActionProps {
  readonly label: string;
  readonly icon: ReactNode;
  /** Size + fill, e.g. `h-[80px] w-[80px] bg-ios-green`. */
  readonly className: string;
  readonly disabled?: boolean;
  readonly testId?: string;
  readonly onClick: () => void;
}

/** Answer / Decline / End Call: the large solid circles, always icon-only. */
export function CircleAction({
  label,
  icon,
  className,
  disabled = false,
  testId,
  onClick,
}: CircleActionProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex items-center justify-center rounded-full text-white",
        "shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
        // ~0.96 scale on press with a spring-ish curve is the system button
        // feedback (research/ios-call-ui.md §4).
        "transition-transform duration-150 ease-ios active:scale-[0.96] disabled:opacity-60",
        className,
      )}
    >
      {icon}
    </button>
  );
}

/**
 * The incoming screen's upper row: ~58pt circle with an ~11pt label beneath
 * (research/ios-call-ui.md §1.6).
 *
 * Inert by design. iOS 17 actually dropped "Remind Me" for Live Voicemail
 * (§1.1), and neither action means anything in a staged call — but the row is
 * what makes the layout read as post-iOS-17 rather than the old centred pair, so
 * it stays as chrome and is hidden from assistive tech.
 */
export function SecondaryAction({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <div aria-hidden="true" className="flex flex-col items-center gap-[6px]">
      <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-white/16 text-white backdrop-blur-[20px] backdrop-saturate-[180%]">
        {icon}
      </div>
      <span className="text-[12px] leading-none font-normal text-white/90">{label}</span>
    </div>
  );
}
