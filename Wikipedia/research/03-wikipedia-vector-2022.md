# Research lane 3 — Wikipedia desktop anatomy (Vector 2022 skin)

Verified 2026-08-18 against en.wikipedia.org's served CSS bundles (`load.php`:
`skins.vector.styles`, `site.styles`, `mediawiki.skinning.*`) and the raw HTML of
`/wiki/Kangaroo`. Items marked *unverified* were not captured and follow documented
convention instead.

## Page chrome

- `#mw-page-container`: `min-width:18.75em; max-width:99.75rem; margin:0 auto;
  padding-inline:1.5rem; background:#fff`.
- Header (`.vector-header`): start = hamburger "Main menu" button + logo lockup;
  end = search box (Codex `.cdx-search-input`, placeholder "Search Wikipedia",
  magnifier start-icon, auto-expands on focus) + user links ("Create account",
  "Log in", notifications) + Appearance dropdown.
- **Sticky header** is a *separate duplicate* DOM node (`#vector-sticky-header`,
  `position:sticky`, `min-height:3.125rem`, bg `#fff`) that slides in after
  scrolling past the real header.
- Content column: `.mw-body` grid with `minmax(0, 59.25rem)` → **948px max**,
  `column-gap:24px`.
- Left rail: swappable Main menu / **Contents TOC** panels. TOC:
  `width:max-content; min-width:200px; max-width:min(0.85*59.25rem, 75vw)`, inside
  a sticky container `top:24px; max-height:calc(100vh - 48px); overflow:hidden auto`.
  First TOC entry is literally "(Top)".
- Right rail (`.vector-column-end`): `width:12.25rem`/`15.5rem`, `margin-top:2.8rem`
  (page tools / appearance).

## Title area (the fact most replicas get wrong)

The h1 is NOT in the site header. Order inside `<main id="content" class="mw-body">`:
1. `header.mw-body-header.vector-page-titlebar`: TOC toggle (narrow widths) →
   `h1#firstHeading` → `#p-lang-btn` ("N languages" blue pill with globe icon).
2. A separate `.vector-page-toolbar`: left = **Article | Talk** tabs (selected tab
   marked), right = **Read | Edit | View history** tabs + Tools dropdown.
3. `#siteSub` "From Wikipedia, the free encyclopedia" below.
- `#firstHeading{margin:0}`; `h1{font-size:188%; font-weight:normal}`.
- Short description div exists in markup but is `display:none` on desktop.

## Typography

- Body: generic `sans-serif` (Codex layers `'Helvetica Neue', Helvetica, Arial`);
  body copy ~14px/0.875rem with `--line-height-content` (exact token resolution
  unverified — historically 14px / 1.6).
- Serif stack (h1 + section headings): `'Linux Libertine','Georgia','Times','Source Serif 4',serif` (exact, verified).
- `h2`: `font-size:1.5em; font-weight:normal; margin-bottom:0.6em;
  border-bottom:1px solid #a2a9b1`.
- Edit-section links: sans-serif, `font-size:small`, `margin-left:1em`; modern
  Vector renders a pencil icon, classic `[edit]` text remains the fallback.

## Colors (verified)

| Element | Value |
|---|---|
| Link | `#3366cc` (hover `#3056a9`, active `#233566`) |
| Visited link | `#6a60b0` (hover `#534fa3`) |
| Red (new-page) link | `#bf3c2c` (visited `#9f5555`) |
| Body bg | `#fff` · subtle bg (infobox/chrome) `#f8f9fa` |
| Primary text | `#202122` |
| h2 border | `#a2a9b1` · infobox border `#dadde3` (Vector override; legacy `#a2a9b1`) |

## Infobox (Vector 2022 net effect)

`float:right; clear:right; max-width:320px; margin:0.5em 0 1em 35px;
border:1px solid #dadde3; background:#f8f9fa; font-size:90%; line-height:1.5;
border-spacing:3px; color:#202122`. Title row bold, centered, ~110%.

## Other content elements

- Hatnote (*unverified, documented convention*): `div[role=note].hatnote`, italic,
  `padding-left:1.6em`.
- External links carry a small arrow SVG (`background-size:0.857em; padding-right:1em`).
- References: `.references{font-size:90%}`; `sup.reference` for `[1]` markers;
  reflist columns via `column-width` (breakpoints unverified).
- Footer: "This page was last edited on …", license line, footer link rows on
  `#f8f9fa`.

## Main Page

Same chrome; content is a hand-built grid of colored panels ("From today's
featured article", "Did you know…", "In the news", "On this day"). Low fidelity
captured — our base page is an *article-styled* page anyway (per product intent).

## Logo / trademark

The puzzle-globe and "WIKIPEDIA" lockup are Wikimedia trademarks. Per repo
convention (no third-party assets), draw an original simple globe SVG and set the
wordmark in plain serif text; do not reproduce the puzzle-globe.
