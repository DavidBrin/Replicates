"use client";

/**
 * The last boundary: a throw in the root layout itself.
 *
 * This replaces the root layout rather than rendering inside it, which is why
 * it declares its own `<html>` and `<body>` — and why every style here is
 * inline. `globals.css` is imported by `layout.tsx` and the two typefaces are
 * loaded by it, so at the moment this component renders, neither the stylesheet
 * nor the font variables are guaranteed to exist. A Tailwind class here would
 * be a class name with nothing behind it, and the one screen whose job is to
 * survive a failed layout would be unstyled text.
 *
 * Hence the duplication with `StopScreen`, which is deliberate: sharing that
 * component would reintroduce exactly the dependency this file exists to do
 * without. The palette below is copied from `globals.css` for the same reason —
 * the tokens are CSS custom properties defined in the stylesheet that has not
 * loaded.
 *
 * `reset()` re-mounts the whole tree. There is no "back to the menu" here
 * because routing is part of what may have failed; a full reload is the honest
 * offer.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "2rem 1.5rem",
          background: "#f2f0eb",
          color: "#090b0c",
          textAlign: "center",
          fontFamily: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <svg viewBox="0 0 100 100" width="64" height="64" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r="32"
            fill="none"
            stroke="#090b0c"
            strokeWidth="10"
            strokeDasharray="150 30"
            strokeDashoffset="20"
          />
          <g fill="#090b0c">
            <rect x="43" y="4" width="14" height="40" />
            <rect x="43" y="56" width="14" height="40" />
            <rect x="4" y="43" width="40" height="14" />
            <rect x="56" y="43" width="40" height="14" />
          </g>
          <circle cx="50" cy="50" r="13" fill="#ad0000" />
        </svg>

        <h1
          style={{
            margin: 0,
            fontSize: "clamp(2.2rem, 9vw, 4rem)",
            lineHeight: 1,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            transform: "skewX(-12deg)",
            textShadow: "0 5px 0 rgb(173 0 0 / 0.95)",
          }}
        >
          No contest
        </h1>

        <p style={{ margin: 0, maxWidth: "34rem", fontSize: "1rem", fontWeight: 700, opacity: 0.7 }}>
          The game failed to start. Reloading is the only way on from here.
        </p>

        {error.digest ? (
          <code style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.75rem", opacity: 0.55 }}>
            Digest {error.digest}
          </code>
        ) : null}

        <button
          type="button"
          onClick={reset}
          style={{
            border: "4px solid #090b0c",
            background: "#ffd500",
            color: "#090b0c",
            padding: "0.75rem 2.5rem",
            fontFamily: "inherit",
            fontSize: "1.25rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: "pointer",
            transform: "skewX(-12deg)",
            boxShadow: "0 8px 0 rgb(0 0 0 / 0.45)",
          }}
        >
          <span style={{ display: "inline-block", transform: "skewX(12deg)" }}>Reload</span>
        </button>
      </body>
    </html>
  );
}
