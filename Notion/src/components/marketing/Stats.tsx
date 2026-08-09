import { Marquee } from "./Marquee";
import { STATS } from "./copy";

/**
 * The proof-point ticker: a slower, denser second marquee that sits between
 * the feature sections and the testimonials.
 */
export function Stats() {
  return (
    <section
      className="py-10"
      style={{
        borderBlock: "1px solid var(--mkt-border-base)",
        background: "var(--mkt-gray-100)",
      }}
      aria-label="By the numbers"
    >
      <Marquee durationSeconds={64}>
        {STATS.map((stat) => (
          <span key={stat} className="flex items-center">
            <span
              className="px-6 text-[clamp(15px,1.7vw,18px)] font-medium whitespace-nowrap"
              style={{ color: "var(--mkt-gray-700)" }}
            >
              {stat}
            </span>
            <span
              className="size-1 shrink-0 rounded-full"
              style={{ background: "var(--mkt-gray-400)" }}
              aria-hidden="true"
            />
          </span>
        ))}
      </Marquee>
    </section>
  );
}
