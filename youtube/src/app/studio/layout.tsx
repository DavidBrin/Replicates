import type { Metadata } from "next";
import Link from "next/link";

/**
 * Studio's shell, and Studio's own type.
 *
 * ## Why this is not the app shell
 *
 * `studio.youtube.com` is a different application with a different token
 * namespace layered over the same colours (R9 §12), and the two differ in ways
 * that are obvious side by side:
 *
 *   masthead   **64px**, where the watch app's is 56 at every measured width
 *   left nav   **248px** wide, where the guide is 240 expanded / 72 mini
 *   nav item   215 × 40, radius 8px, margin 0 12px, label 14/20 — w500 when
 *              active, w400 otherwise, on `rgba(255,255,255,0.1)`
 *
 * So Studio does not reuse `AppShell`. Sharing it would mean one of the two
 * surfaces wearing the other's chrome, and the 8px difference in masthead
 * height is exactly the sort of thing that reads as "not quite right" without
 * anyone being able to say why.
 *
 * ## The `--ytcp-font-*` typescale
 *
 * This is the one thing Studio has that the main app does not: **a complete
 * named typescale** (R9 §12.1). `globals.css` records that the watch app "has
 * no named typescale — it inlines sizes per component", and its `--yt-type-*`
 * roles are this project's naming of those inlined sizes. Studio ships 90
 * `--ytcp-font-*` properties of its own, and the thirteen roles below are
 * transcribed from the capture.
 *
 * They are declared here rather than in `globals.css` for two reasons. They
 * belong to one route subtree, so putting them on `:root` would offer every
 * other surface a scale it must not use; and `globals.css` is another slice's
 * file. The values are `rem` against a 10px root in the real product — this
 * project deliberately does not set `html { font-size: 62.5% }` (see the
 * typography note in `globals.css`), so they are transcribed as the px they
 * resolve to.
 *
 * `@layer components` is load-bearing, not tidiness. `globals.css`'s base block
 * explains the mechanism: unlayered CSS beats layered CSS whatever the
 * specificity, so an unlayered `.ytcp-body1 { font-size: 14px }` would silently
 * defeat every Tailwind text utility applied alongside it. Declaring the layer
 * puts these between Tailwind's `base` and its `utilities`, which is where a
 * component-level type role belongs.
 */

export const metadata: Metadata = {
  title: {
    default: "Studio",
    template: "%s - Studio",
  },
};

const STUDIO_TYPESCALE = `
@layer components {
  .ytcp-display1   { font-size: 40px; line-height: 54px; font-weight: 300; }
  .ytcp-headline   { font-size: 24px; line-height: 32px; font-weight: 700; }
  .ytcp-title      { font-size: 20px; line-height: 28px; font-weight: 700; }
  .ytcp-card-title { font-size: 18px; line-height: 26px; font-weight: 700; }
  .ytcp-subheading { font-size: 16px; line-height: 22px; font-weight: 400; }
  .ytcp-subheading2{ font-size: 16px; line-height: 22px; font-weight: 500; }
  .ytcp-body1      { font-size: 14px; line-height: 20px; font-weight: 400; }
  .ytcp-body2      { font-size: 14px; line-height: 20px; font-weight: 500; }
  .ytcp-button     { font-size: 14px; line-height: 20px; font-weight: 500; }
  .ytcp-caption1   { font-size: 12px; line-height: 18px; font-weight: 400; }
  .ytcp-caption2   { font-size: 12px; line-height: 18px; font-weight: 500; }
}
`;

/**
 * The eleven items R9 §12.2 lists, in order, with Settings and Send feedback in
 * the footer group. Only Content and the dashboard are routes this slice
 * builds; the rest are rendered and inert rather than omitted, because the nav
 * *is* the measured surface and a three-item version of it is a different
 * product. Each inert item says so through `aria-disabled` rather than by
 * looking identical to a live one.
 */
const NAV_ITEMS: readonly { label: string; href?: string }[] = [
  { label: "Dashboard", href: "/studio" },
  { label: "Content", href: "/studio" },
  { label: "Analytics" },
  { label: "Community" },
  { label: "Subtitles" },
  { label: "Content detection" },
  { label: "Earn" },
  { label: "Customization" },
  { label: "Audio library" },
];

const FOOTER_ITEMS: readonly { label: string }[] = [
  { label: "Settings" },
  { label: "Send feedback" },
];

export default function StudioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-full">
      {/* React 19 hoists a `<style>` carrying `href` + `precedence` into the
          document head and dedupes it across every Studio route. */}
      <style href="studio-typescale" precedence="medium">
        {STUDIO_TYPESCALE}
      </style>

      {/* §12.2: 64px, on the base background — not the 56px of the watch app. */}
      <header className="sticky top-0 z-[var(--yt-z-masthead)] flex h-16 items-center gap-4 bg-base px-6">
        <Link href="/studio" className="ytcp-title">
          Studio
        </Link>
        <span className="ytcp-caption1 text-secondary">
          Your browser does the transcoding
        </span>
      </header>

      <div className="flex">
        {/* §12.2: 248px wide, 8px right padding. */}
        <nav
          aria-label="Studio"
          className="hidden w-[248px] shrink-0 pr-2 md:block"
        >
          <ul className="m-0 list-none p-0">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.label} {...item} />
            ))}
          </ul>
          <hr className="mx-3 my-3 border-0 border-t border-outline" />
          <ul className="m-0 list-none p-0">
            {FOOTER_ITEMS.map((item) => (
              <NavItem key={item.label} {...item} />
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 px-6 pb-16">{children}</main>
      </div>
    </div>
  );
}

/** 215 × 40, radius 8px, margin 0 12px, padding 8px 8px 8px 4px (§12.2). */
function NavItem({ label, href }: { label: string; href?: string }) {
  const shape =
    "ytcp-body1 flex h-10 w-[215px] items-center rounded-compact px-2 py-2 pl-1";

  return (
    <li className="mx-3">
      {href ? (
        <Link href={href} className={shape}>
          {label}
        </Link>
      ) : (
        <span aria-disabled="true" className={`${shape} text-disabled`}>
          {label}
        </span>
      )}
    </li>
  );
}
