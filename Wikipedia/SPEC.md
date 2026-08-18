# Wikipedia — Spec

A replica of the desktop Wikipedia (Vector 2022 skin) that serves as the channel
guide for **David's Internet**: an encyclopedia whose articles are the projects in
this repository. The base page is itself a Wikipedia-style article about David's
Internet, linking to one article per project; each project article explains the
project and carries a (stubbed, until deployments exist) link to the live site.

Derived from `research/01-repo-conventions.md`, `research/02-project-dossiers.md`
and `research/03-wikipedia-vector-2022.md`. Nothing here is specced from memory.

## Product requirements

1. **Base page** (`/`) renders the article **"David's Internet"** — visually a
   normal Wikipedia article: lead section with bold subject, infobox, TOC,
   sections, and a wikitable of the seven projects, each linking to its article.
2. **Project articles** at `/wiki/<Title>` for: Linear, Notion, YouTube,
   Super Smash, Fake Phone, Bet, Dollar Pixels. Each has: hatnote linking to the
   product it replicates, lead, infobox (type, stack, tests, built-with lane/slice
   counts, repository path, **Website** row), 3–5 body sections drawn only from
   the dossier facts, References (real citations from the READMEs), See also,
   External links, and category bar.
3. **Link stubs**: no project is deployed yet, so every "Website" / external-link
   slot renders as a Wikipedia **red link** (`#bf3c2c`) with title-attribute
   "the project is not deployed yet"; a red link click routes to a
   Wikipedia-style "page does not exist" screen explaining the stub. Adding a
   real URL is a one-line data change documented step-by-step in the README.
4. **Search**: header search box does client-side prefix/substring match over
   article titles with a suggestion dropdown (Codex-style), Enter/click navigates.
5. **Navigation chrome**: main-menu sidebar (Main page, Random article — both
   functional), sticky Contents TOC with "(Top)" and active-section highlight,
   Article/Talk + Read/Edit/View history toolbar (non-functional controls are
   greyed with an explanatory tooltip, never dead-looking-but-clickable),
   "N languages" pill (greyed, "1 language"), footer with last-edited line and
   license row.
6. **Fidelity bar**: side-by-side screenshot comparison against en.wikipedia.org
   at 1440px must show matching chrome layout, title typography, link colors,
   infobox geometry, section rules and TOC placement. Iterated by a design agent
   until differences are content, not design.

## Architecture

Static Next.js app — **no database, no env vars, no ports/adapters** (there is no
IO to swap; the content is the repo itself).

- `src/content/` — typed article data. `projects.ts` holds per-project metadata
  incl. `liveUrl: string | null` (the one field to edit when a deployment goes
  live). `articles/*.tsx` compose article bodies from wiki primitives.
- `src/components/wiki/` — content primitives: `Section`, `P`, `WikiLink`
  (internal; renders red styling when target missing), `ExternalLink` (arrow
  icon; red-stub when null), `Infobox`, `Hatnote`, `Ref`/`References`,
  `WikiTable`, `Categories`.
- `src/components/chrome/` — `Header`, `StickyHeader`, `SearchBox`, `Sidebar`,
  `Toc`, `PageTitlebar`, `PageToolbar`, `Footer`.
- `src/app/` — `layout.tsx` (chrome grid), `page.tsx` (renders the David's
  Internet article), `wiki/[slug]/page.tsx` (static params from the registry),
  `wiki/[slug]/not-found` behavior for red-link stubs.
- `src/lib/registry.ts` — article registry: slug → module; drives static params,
  search, random article, and WikiLink existence checks.
- `globals.css` — Vector 2022 tokens from research lane 3 (exact hex values),
  Tailwind v4 with `source(none)` + explicit `@source` (lane 1 gotcha).

## Design tokens (from lane 3 — use exactly)

Links `#3366cc`/hover `#3056a9`/active `#233566`; visited `#6a60b0`; red link
`#bf3c2c`. Text `#202122`. Subtle bg `#f8f9fa`. Rules `#a2a9b1`; infobox border
`#dadde3`, max-width 320px, float right, margin `0.5em 0 1em 35px`, 90% font.
h1 `188%` normal weight, serif `'Linux Libertine','Georgia','Times','Source Serif 4',serif`;
h2 `1.5em` normal with 1px `#a2a9b1` bottom border. Body sans-serif 14px/1.6.
Content column max 59.25rem; page container max 99.75rem, padding-inline 1.5rem.
Original globe SVG + serif wordmark (no Wikimedia trademark assets).

## Testing

- **Unit (Vitest/jsdom)**: registry integrity (every project has an article, all
  WikiLink targets exist, references numbered consistently), search matching,
  red-link stub logic (`liveUrl: null` vs set), component rendering of infobox/
  TOC-from-sections, layout smoke per article.
- **e2e (Playwright, desktop-chrome 1440×900)**: base page renders article
  anatomy; navigate to each project article; TOC jump + sticky; search suggest +
  navigate; red-link stub page; random article; screenshots spec writing
  `docs/screenshots/` (CAPTURE=1 gate, per dollar-pixels convention).

## Delivery

Straight to `main` (personal repo convention), one commit per meaningful stage.
README must include: project description blurb (for the root README/homepage),
local test instructions, Vercel deploy section, and the step-by-step "add your
live project link" guide. DECISIONS.md logs every non-obvious call.
