"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HERO } from "./copy";

const ROTATE_MS = 2600;

/**
 * The inline pill in the hero headline that cycles Think → Ship → Create → Jam.
 *
 * The pill *morphs* between words rather than snapping: a hidden mirror of
 * every word is rendered in the same type context, its measured width is
 * applied to the live pill, and CSS transitions the change. Measuring instead
 * of hard-coding widths means it stays correct at every clamp step of the
 * responsive headline, and if the font swaps in late.
 */
export function HeroPill() {
  const words = HERO.rotatingWords;
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const mirrors = useRef<Array<HTMLSpanElement | null>>([]);

  const measure = useCallback(() => {
    const el = mirrors.current[index];
    if (el) setWidth(el.getBoundingClientRect().width);
  }, [index]);

  // A plain effect, not a layout effect: the pill's natural `auto` width is
  // already correct for the first word, so there is nothing to correct before
  // paint — and `useLayoutEffect` would warn during server rendering.
  useEffect(measure, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    const id = setInterval(
      () => setIndex((current) => (current + 1) % words.length),
      ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [words.length]);

  return (
    <>
      <span className="mkt-pill" style={{ width }}>
        <span className="mkt-pill__dot" aria-hidden="true" />
        {/* Keyed by word so the enter animation replays on every swap. */}
        <span key={words[index]} className="mkt-pill__word">
          {words[index]}
        </span>
      </span>

      {/* Hidden mirrors — same class, same type context, so the measurement
          includes the pill's own padding and gap. */}
      <span aria-hidden="true">
        {words.map((word, i) => (
          <span
            key={word}
            ref={(node) => {
              mirrors.current[i] = node;
            }}
            className="mkt-pill mkt-pill__mirror"
          >
            <span className="mkt-pill__dot" />
            <span className="mkt-pill__word">{word}</span>
          </span>
        ))}
      </span>
    </>
  );
}
