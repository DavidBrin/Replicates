# Research lane 1 — Repo conventions (from `youtube` and `dollar-pixels`)

Extracted 2026-08-18 by a codebase reader agent from the two most recent replicas.

## Stack (exact versions to reuse)

- `next` 16.3.0, `react`/`react-dom` 19.2.8, `typescript` ^5
- `tailwindcss` ^4 + `@tailwindcss/postcss` ^4 (no tailwind.config.js — v4 config lives in CSS)
- `vitest` ^4.1.10 (+ `@vitest/coverage-v8`), `@playwright/test` ^1.56+, `eslint` ^9 + `eslint-config-next` 16.3.0
- `@testing-library/jest-dom` ^7, `react` ^16.3.2, `user-event` ^14.6.3; `jsdom` ^30; `@vitejs/plugin-react` ^6; `vite` ^8.2.1 + `vite-tsconfig-paths` ^6.1.1
- `clsx` ^2.1.1; `@types/node` ^20
- pnpm via `pnpm-lock.yaml` + `pnpm-workspace.yaml` (no `packageManager` field)

## Scripts

`dev`, `build`, `start`, `lint` (`eslint .`), `test` (`vitest run`), `test:watch`,
`test:e2e` (`playwright test`), `test:e2e:ui`, `typecheck` (`tsc --noEmit`).

## Config gotchas (all learned the hard way by siblings)

- **next.config.ts**: intentionally minimal; `reactStrictMode: true`, `devIndicators: false`
  (badge overlaps screenshots), `turbopack.root` pinned via `fileURLToPath(new URL(".", import.meta.url))`
  — stops Turbopack walking up to a sibling project's lockfile in this multi-project repo.
- **tsconfig**: strict, `moduleResolution: bundler`, `paths: {"@/*": ["./src/*"]}`.
- **globals.css**: `@import "tailwindcss" source(none);` + explicit `@source "../**/*.{ts,tsx}"`
  — otherwise Tailwind v4's content scan walks into `research/screenshots/` binary images and
  generates invalid CSS (broke every route in the Linear replica).
- **vitest.config.mts**: alias `server-only` to a stub; use `fileURLToPath`, **not** `URL.pathname`
  (this repo's path contains a space; `.pathname` percent-encodes and breaks resolution).
  `environment: "jsdom"`, `globals: true`, `css: false`.
- **playwright.config.ts**: configurable `PORT` env override (sibling dev servers camp on :3000),
  `fullyParallel: false, workers: 1`, `retries: CI ? 2 : 0`, `trace: "on-first-retry"`.
- Fonts: never `next/font/google` — OS-native stacks declared in CSS.

## src/ layout

`src/app` (thin App Router routes) · `src/components` (by feature) · `src/domain`
(pure logic, no React/Next imports — siblings enforce this with a layering test) ·
`src/lib` (helpers). Ports/adapters only where there is real IO to swap; a static
site does not need them.

## Docs conventions

- `README.md`: `# name — tagline` → blockquote hook → description naming the real product →
  the one architectural bet in bold → quick start → named narrative `##` sections →
  closing stats sentence + `[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Research](research)` row.
- `DECISIONS.md`: numbered `D1…` entries, each stating the decision, the rejected
  alternative(s), and what it costs. Continues growing during review.
- `docs/screenshots/*.png` = screenshots of the **replica** (embedded in READMEs);
  `research/screenshots/` = reference captures of the **real product**.
- Root `README.md` gets a compressed per-project entry: heading link, blockquote hook,
  one paragraph, screenshot table at width=240, stats sentence, link row.

## Vercel

Zero config: import the repo, point the project root at the project folder. Siblings
with databases document Neon; a static project deploys with no env vars at all.
