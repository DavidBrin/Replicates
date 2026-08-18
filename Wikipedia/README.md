# Wikipedia — the channel guide for David's Internet

> **an encyclopedia whose every article is a project in this repository**

A replica of desktop Wikipedia (the Vector 2022 skin), rebuilt as the "channel
guide" for **David's Internet** — a planned search engine over the portfolio
projects in this repo. A search engine is not a dashboard: it needs somewhere to
send you that *explains* what each project is. That somewhere is an encyclopedia.
The base page is itself a Wikipedia-style article about David's Internet, and
every sibling replica (Linear, Notion, YouTube, Super Smash, Fake Phone, Bet,
Dollar Pixels) gets an article written in encyclopedic register from its own
README — with an infobox, references, categories, and a link to the live project.

None of the projects are deployed yet, so every "Website" link renders as a
Wikipedia **red link** — the site's own idiom for a page that does not exist —
and clicking one lands on a Wikipedia-style "this page is not deployed yet"
screen. Turning a red link blue is a one-line change (see below).

The chrome is measured, not remembered: link blues (`#3366cc`, visited
`#6a60b0`), the red of a missing page (`#bf3c2c`), the 948px content column, the
320px right-floated infobox, the serif `Linux Libertine` title at 188% normal
weight sitting *above* the Article/Talk toolbar — all verified against
en.wikipedia.org's served CSS during the research phase
([research/03](research/03-wikipedia-vector-2022.md)). The puzzle-globe is a
Wikimedia trademark, so the logo here is an original globe drawing under the
same wordmark treatment ([DECISIONS D2](DECISIONS.md)).

## Project description (for the homepage)

> **Wikipedia** — the free project encyclopedia. A replica of desktop Wikipedia
> that serves as the channel guide for David's Internet: one encyclopedic
> article per portfolio project, with measured Vector 2022 chrome, infoboxes,
> references and categories — and red links standing in for every project that
> is not deployed yet.

## Running it locally

```
pnpm install
pnpm run dev        # http://localhost:3000
```

No database, no environment variables — the content is the repository itself.

| Command | What it does |
|---|---|
| `pnpm run test` | unit tests (Vitest) |
| `pnpm run test:e2e` | Playwright e2e (starts its own server on port 3211) |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run lint` | ESLint |
| `pnpm run build` | production build |

## Adding a live project link

Each article's "Website" row and External-links section read one field. When a
project goes live:

1. Open [`src/content/projects.ts`](src/content/projects.ts).
2. Find the project's entry and change `liveUrl: null` to the deployed URL,
   e.g. `liveUrl: "https://linear-replica.vercel.app"`.
3. That is the whole change: the red stub link becomes a normal blue external
   link (with Wikipedia's external-arrow icon) in the infobox and in the
   article's External links section.
4. Run `pnpm run test` — a stub-guard test asserts which projects are expected
   to be live; update its expectation list to include the project you just
   linked (the test failure message names the file and line).
5. Commit both files together.

## Deploying to Vercel

Zero configuration, like every project in this repo:

1. Import the repository on [vercel.com/new](https://vercel.com/new).
2. Set the project **Root Directory** to `Wikipedia/`.
3. Deploy. There are no environment variables to set; every route is static.

## Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Research](research)
