/**
 * `header.mw-body-header.vector-page-titlebar`: h1#firstHeading + a greyed
 * "N languages" pill with a globe icon. Per research/03 this sits ABOVE
 * the Article/Talk + Read/Edit toolbar, not below it.
 */
export function PageTitlebar({ title }: { title: string }) {
  return (
    <header className="mw-body-header flex min-h-10 flex-wrap items-center justify-between gap-2">
      <h1 id="firstHeading">
        {title}
      </h1>
      {/*
        `#p-lang-btn` is a 32px-tall quiet button — 14px bold text, a
        language glyph, a chevron, 11px of side padding and a *transparent*
        border that only shows on hover. It is not the rounded 12px capsule
        this used to draw. Greyed rather than blue, per DECISIONS D5.
      */}
      <span
        className="flex h-8 shrink-0 cursor-not-allowed select-none items-center gap-1.5 rounded-[2px] border border-transparent px-[11px] text-[14px] font-bold text-[color:var(--text)]/50"
        title="Language switching is not functional in this replica"
        aria-disabled="true"
      >
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <ellipse cx="10" cy="10" rx="3.5" ry="8" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        1 language
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="ml-0.5">
          <path d="M1.5 4L6 8.5L10.5 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </span>
    </header>
  );
}
