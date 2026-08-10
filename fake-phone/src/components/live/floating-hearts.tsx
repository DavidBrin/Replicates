"use client";

/**
 * Hearts rising from the bottom-right.
 *
 * research/instagram-live-ui.md §4: multi-coloured, varied size and opacity,
 * spawned near the bottom-right, drifting up with a gentle sine wobble and
 * fading near the top of travel, ~2–3s lifetime. The research is explicit that
 * this is a category-wide pattern (Facebook Live popularised it) and that it is
 * the cheapest high-payoff element on the screen — so it is a few dozen lines
 * of CSS, not a physics engine.
 *
 * The wobble is two nested elements: the outer one rises, the inner one
 * alternates left/right on an ease-in-out timing function, which is a sine in
 * everything but name and costs nothing to animate on the compositor.
 */

import { useEffect, useRef, useState } from "react";

import { createSeededRandom } from "@/domain/live-session";

import { HeartIcon } from "./icons";

/** §4: multi-coloured, not one colour. Deliberately a generic warm/cool spread
 * — no platform's brand palette. */
const HEART_COLORS = ["#ff4d6d", "#ff8fab", "#c77dff", "#ffb703", "#4cc9f0"] as const;

interface Heart {
  readonly id: number;
  readonly color: string;
  readonly size: number;
  readonly drift: number;
  readonly rise: number;
  readonly duration: number;
  readonly delay: number;
  readonly opacity: number;
}

/** Mean gap between hearts. Fast enough to read as continuous reaction, slow
 * enough that the lower-right corner never becomes a wall of hearts. */
const SPAWN_MS = 900;
const LIFETIME_MS = 3_200;

/**
 * Mounted only while the stream is live, and unmounted the moment it is not —
 * which is also how the heart list is cleared. Keeping an `active` prop instead
 * would mean clearing state from inside an effect for no gain.
 */
export function FloatingHearts() {
  const [hearts, setHearts] = useState<readonly Heart[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    // `globals.css` collapses every animation to 0.01ms under
    // `prefers-reduced-motion`. Rather than fight that (and produce hearts that
    // flash in and out instantly, which is worse than none), we simply do not
    // spawn any. The badge, the count and the comment stream still carry the
    // illusion.
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    // Seeded rather than `Math.random()` so the visual is reproducible when
    // debugging, and so nothing in this component reaches for global entropy
    // during a render.
    const random = createSeededRandom(0x5eed);

    const spawn = () => {
      const id = nextId.current++;
      const heart: Heart = {
        id,
        color: HEART_COLORS[Math.floor(random() * HEART_COLORS.length)],
        size: 16 + Math.floor(random() * 16),
        drift: 14 + Math.floor(random() * 26),
        rise: 180 + Math.floor(random() * 180),
        duration: LIFETIME_MS * (0.8 + random() * 0.5),
        delay: Math.floor(random() * 220),
        opacity: 0.6 + random() * 0.4,
      };
      setHearts((current) => [...current, heart]);
      // Removed on a timer rather than `animationend`: a backgrounded tab may
      // never fire the event, and an unbounded list of hearts is a leak.
      setTimeout(
        () => setHearts((current) => current.filter((h) => h.id !== id)),
        heart.duration + heart.delay + 200,
      );
    };

    // The first heart is on a timeout rather than an immediate call: spawning
    // during the effect itself would set state synchronously on mount and
    // cascade an extra render on the frame the camera is starting up, which is
    // the busiest frame this screen has.
    const first = setTimeout(spawn, 400);
    const timer = setInterval(spawn, SPAWN_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  if (hearts.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-16 right-3 z-40 h-64 w-24 overflow-hidden"
    >
      {hearts.map((heart) => (
        <span
          key={heart.id}
          className="fp-live-heart-rise absolute bottom-0 right-2"
          style={{
            animationDuration: `${heart.duration}ms`,
            animationDelay: `${heart.delay}ms`,
            ["--fp-rise" as string]: `${heart.rise}px`,
          }}
        >
          {/* Inline size/colour/opacity: every heart differs, so these cannot
              be Tailwind classes without minting a class per heart. */}
          <span
            className="fp-live-heart-wobble block"
            style={{
              animationDuration: `${heart.duration / 2}ms`,
              ["--fp-drift" as string]: `${heart.drift}px`,
              color: heart.color,
              opacity: heart.opacity,
              width: `${heart.size}px`,
              height: `${heart.size}px`,
            }}
          >
            <HeartIcon className="block h-full w-full" />
          </span>
        </span>
      ))}
    </div>
  );
}
