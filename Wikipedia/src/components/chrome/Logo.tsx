import Link from "next/link";

/**
 * Original simple meridian-globe mark + serif wordmark. Per DECISIONS D2,
 * this is deliberately NOT the Wikimedia puzzle-globe — just a plain
 * sphere with latitude/longitude lines, drawn as inline SVG (no fetched
 * assets).
 */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[color:var(--text)] no-underline">
      {/*
        The served lockup is 140x38 overall: a ~32px mark, the wordmark set
        around 19px with wide letter-spacing, and an 11px serif tagline 5px
        beneath it. The tagline is serif and sentence-cased on the real site,
        not the uppercase sans this used to draw.
      */}
      <svg
        width="32"
        height="32"
        viewBox="0 0 36 36"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="18" cy="18" r="16" fill="none" stroke="#a2a9b1" strokeWidth="1" />
        <ellipse cx="18" cy="18" rx="7" ry="16" fill="none" stroke="#a2a9b1" strokeWidth="1" />
        <ellipse cx="18" cy="18" rx="16" ry="7" fill="none" stroke="#a2a9b1" strokeWidth="1" />
        <line x1="2" y1="18" x2="34" y2="18" stroke="#a2a9b1" strokeWidth="1" />
        <line x1="18" y1="2" x2="18" y2="34" stroke="#a2a9b1" strokeWidth="1" />
      </svg>
      <span className="flex flex-col leading-none">
        <span
          className="font-serif text-[19px] font-normal"
          style={{ fontVariant: "small-caps", letterSpacing: "0.02em" }}
        >
          Wikipedia
        </span>
        <span className="mt-[5px] font-serif text-[11px] leading-none text-[color:var(--text)]/80">
          The free encyclopedia
        </span>
      </span>
    </Link>
  );
}
