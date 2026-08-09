"use client";

import { useEffect, useState } from "react";
import { Container } from "./Marketing";
import { DoodleFace } from "./icons";
import { TESTIMONIALS } from "./copy";

const ROTATE_MS = 6000;

/**
 * Social proof: one anchoring pull-quote, plus a rotating shorter quote so the
 * section carries four customers in the space of one.
 *
 * The rotation pauses on hover and can be driven directly from the dots, so it
 * never traps a reader mid-sentence.
 */
export function Testimonials() {
  const quotes = TESTIMONIALS.rotating;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(
      () => setIndex((current) => (current + 1) % quotes.length),
      ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [paused, quotes.length]);

  const quote = quotes[index];

  return (
    <section className="mkt-section">
      <Container>
        <h2 className="mkt-h2 mkt-h2--display text-center">
          {TESTIMONIALS.heading}
        </h2>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
          {/* -- lead pull-quote ------------------------------------------ */}
          <figure
            className="mkt-card p-8 md:p-10"
            style={{
              background: "var(--mkt-blue-100)",
              borderColor: "transparent",
            }}
          >
            <Quote />
            <blockquote
              className="mt-4 text-[clamp(20px,2.6vw,28px)] leading-[1.28] font-medium text-balance"
              style={{
                color: "var(--mkt-text-strong)",
                letterSpacing: "-0.02em",
              }}
            >
              {TESTIMONIALS.lead.quote}
            </blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <Face variant={5} ring="#097FE8" />
              <span className="mkt-small">
                <span
                  className="block font-semibold"
                  style={{ color: "var(--mkt-text-strong)" }}
                >
                  {TESTIMONIALS.lead.name}
                </span>
                <span style={{ color: "var(--mkt-text-muted)" }}>
                  {TESTIMONIALS.lead.role}
                </span>
              </span>
            </figcaption>
          </figure>

          {/* -- rotating shorter quotes ---------------------------------- */}
          <div
            className="mkt-card flex flex-col justify-between p-8 md:p-10"
            style={{ boxShadow: "var(--shadow-200)" }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <figure
              /* keyed so the swap replays the fade */
              key={quote.name}
              className="mkt-tabpanel"
              aria-live="polite"
            >
              <Quote />
              <blockquote
                className="mt-4 text-[clamp(17px,2vw,20px)] leading-[1.4] text-pretty"
                style={{ color: "var(--mkt-text-normal)" }}
              >
                {quote.quote}
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <Face variant={index + 1} ring="#DFDCD9" />
                <span className="mkt-small">
                  <span
                    className="block font-semibold"
                    style={{ color: "var(--mkt-text-strong)" }}
                  >
                    {quote.name}
                  </span>
                  <span style={{ color: "var(--mkt-text-muted)" }}>
                    {quote.role}
                  </span>
                </span>
              </figcaption>
            </figure>

            <div className="mt-8 flex gap-2">
              {quotes.map((item, i) => (
                <button
                  key={item.name}
                  type="button"
                  aria-label={`Show quote from ${item.name}`}
                  aria-current={i === index}
                  onClick={() => setIndex(i)}
                  className="h-1.5 rounded-full transition-all duration-200"
                  style={{
                    width: i === index ? 24 : 8,
                    background:
                      i === index
                        ? "var(--mkt-blue-600)"
                        : "var(--mkt-gray-300)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Quote() {
  return (
    <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
      <path
        d="M0 20V11.8C0 5.6 3.3 1.4 9.6 0l1.2 3.3C7.2 4.5 5.4 6.6 5.4 9.6H10V20H0Zm15 0v-8.2C15 5.6 18.3 1.4 24.6 0l1.2 3.3c-3.6 1.2-5.4 3.3-5.4 6.3H25V20H15Z"
        fill="var(--mkt-blue-400)"
      />
    </svg>
  );
}

function Face({ variant, ring }: { variant: number; ring: string }) {
  return (
    <span
      className="grid size-10 shrink-0 place-items-center rounded-full"
      style={{ background: "#fff", boxShadow: `0 0 0 2px ${ring}` }}
      aria-hidden="true"
    >
      <DoodleFace variant={variant} size={32} />
    </span>
  );
}
