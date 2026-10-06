"use client";

/**
 * The manual dice roll (SPEC §7.2): the **same** cubes as the Blitz view,
 * thrown onto the board at the contested border, tumbling then settling
 * face-up — 3 dice staggered 60 ms, 900 ms tumble, 140 ms settle (§8 Motion).
 *
 * It renders at raw map coordinates inside the board wrapper, like the
 * continent legend, so the camera transform carries it.
 */

import clsx from "clsx";
import { useEffect, useRef } from "react";

import { DiceCube } from "./DiceCube";

export interface ManualDiceViewProps {
  /** The attacker's faces, in throw order. 1–3 of them. */
  readonly attacker: readonly number[];
  /** The defender's faces. 1–2 of them. */
  readonly defender: readonly number[];
  /** The contested border, in map units. */
  readonly at: { readonly x: number; readonly y: number };
  /** Fires once the last cube has settled. */
  readonly onDone: () => void;
  readonly className?: string;
}

const SIZE = 84;
const STAGGER = 60;

export function ManualDiceView({
  attacker, defender, at, onDone, className,
}: ManualDiceViewProps) {
  // The last cube to settle is the one with the greatest stagger.
  const lastSide: "attacker" | "defender" =
    defender.length > attacker.length ? "defender" : "attacker";
  const lastIndex = Math.max(attacker.length, defender.length) - 1;
  const lastRef = useRef<HTMLDivElement | null>(null);

  // A native listener, not React's `onAnimationEnd`: React only registers
  // animation events when the environment exposes `AnimationEvent`.
  useEffect(() => {
    const node = lastRef.current;
    if (node === null) return;
    const handler = (): void => onDone();
    node.addEventListener("animationend", handler);
    return () => node.removeEventListener("animationend", handler);
  }, [onDone]);

  function row(faces: readonly number[], side: "attacker" | "defender", dy: number) {
    const width = faces.length * (SIZE + 10);
    return faces.map((pips, i) => {
      const last = i === lastIndex && side === lastSide;
      return (
      <div
        key={`${side}-${i}`}
        data-testid={`manual-die-${side}-${i}`}
        data-last={last ? "true" : "false"}
        ref={last ? lastRef : undefined}
        style={{
          position: "absolute",
          left: -width / 2 + i * (SIZE + 10),
          top: dy,
        }}
      >
        <DiceCube pips={pips} size={SIZE} tumbling delayMs={i * STAGGER}
          rotate={(i % 2 === 0 ? -1 : 1) * 7} testId={`manual-dice-cube-${side}-${i}`} />
      </div>
      );
    });
  }

  return (
    <div
      data-testid="manual-dice"
      role="status"
      aria-label="Rolling dice"
      className={clsx("manual-dice", className)}
      style={{ position: "absolute", left: at.x, top: at.y, width: 0, height: 0,
        pointerEvents: "none", zIndex: "var(--z-floaters)" as unknown as number }}
    >
      {row(attacker, "attacker", -SIZE - 16)}
      {row(defender, "defender", 16)}
    </div>
  );
}

export default ManualDiceView;
