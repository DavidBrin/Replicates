# Repo conventions for `island-empire` — researched from Linear, super-smash, dollar-pixels, Wikipedia, and root

(Codebase reader lane, 2026-09-21. Every sibling replica is a self-contained Next.js app; this is what they share.)

## 1. Project scaffolding

**package.json** — all three sibling apps share nearly identical scripts/deps. From `Linear/package.json`, `super-smash/package.json`, `dollar-pixels/package.json`:
- Scripts common to all: `dev` (`next dev`), `build` (`next build`), `start`, `lint` (`eslint .`), `test` (`vitest run`), `test:watch`, `test:e2e` (`playwright test`), `test:e2e:ui`, `typecheck` (`tsc --noEmit`).
- Linear adds DB scripts: `"db:push": "node --experimental-strip-types scripts/db-push.ts"`, `"build:schema": "node scripts/build-schema.mjs"`, `"prebuild": "node scripts/build-schema.mjs"`, and `"verify": "pnpm run typecheck && pnpm run lint && pnpm run test"`.
- dollar-pixels overrides `build` to run a prebuild script first: `"build": "node --experimental-strip-types scripts/prebuild.ts && next build"`, and has its own `db:push`.
- Versions pinned identically across all three: `"next": "16.3.0"`, `"react": "19.2.8"`, `"react-dom": "19.2.8"`, `"tailwindcss": "^4"`, `"@tailwindcss/postcss": "^4"`, `"typescript": "^5"`, `"vitest": "^4.1.10"`, `"@playwright/test": "^1.56.1"` (Linear pins `^1.62.1`), `"zod": "^4.x"`, `"zustand": "^5.0.x"` (Linear/super-smash only — dollar-pixels has no zustand), `"eslint": "^9"`, `"eslint-config-next": "16.3.0"`.
- Linear-only deps: `@electric-sql/pglite`, `@neondatabase/serverless`, `fractional-indexing`, `jose`, `lucide-react`, `nanoid`, `server-only`.
- dollar-pixels-only: `@neondatabase/serverless`, `stripe`, `jose`, `nanoid`, `server-only`, plus `"pnpm": {"ignoredBuiltDependencies": ["esbuild"]}`.
- super-smash-only: `trystero` (WebRTC signaling) — no persistence deps at all.
- Dev deps shared everywhere: `@testing-library/{jest-dom,react,user-event}`, `@vitejs/plugin-react`, `@vitest/coverage-v8`, `jsdom`, `vite`, `vite-tsconfig-paths`, `fast-check` (dollar-pixels/super-smash, not Linear).

**tsconfig.json** — near-identical across all three. Linear differs by using `"target": "ES2022"` and adding `"noUncheckedIndexedAccess": true`; super-smash and dollar-pixels use `"target": "ES2017"` with no `noUncheckedIndexedAccess`. All three: `strict: true`, `moduleResolution: "bundler"`, `paths: {"@/*": ["./src/*"]}`, includes `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`, `.next/dev/types/**/*.ts`, `**/*.mts`. dollar-pixels additionally excludes `"scripts"` from tsconfig (because those run via `--experimental-strip-types`, not `tsc`).

**eslint.config.mjs** — byte-identical in all three:
```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
```

**postcss.config.mjs** — identical: `{ plugins: { "@tailwindcss/postcss": {} } }`.

**next.config.ts** — the load-bearing shared pattern. All three have:
- `reactStrictMode: true`, `devIndicators: false` (dev badge overlaps HUD/UI in screenshots).
- `agentRules: false` — comment: `"Don't emit AGENTS.md / CLAUDE.md into the deliverable."`
- `turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) }` — pins Turbopack's workspace root because this is "a subdirectory of a larger multi-project repo, not its own git root." super-smash/dollar-pixels comment: *"The sibling project `bet` hit this and lost `proxy.ts` silently; pinning is cheap insurance."*
- Linear and dollar-pixels (both use `@neondatabase/serverless`) add:
  ```ts
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"], // Linear also has pglite
  outputFileTracingIncludes: { "/*": ["./node_modules/@neondatabase/serverless/**/*"] },
  ```
  Reason quoted: *"Neon must still land in the serverless function: `webpackIgnore` on a variable specifier hid it from file tracing, which is why production 500'd with 'Cannot find package...'"*
- Linear only adds a redirect: `/signup` → `/signin` (portfolio demo has no open sign-up).

**vitest.config.mts** — all use `defineConfig` from `vitest/config` with `plugins: [tsconfigPaths(), react()]`, `test: { environment: "jsdom", globals: true, setupFiles: ["./vitest.setup.ts"], include: ["src/**/*.test.{ts,tsx}"], css: false }`. Linear/dollar-pixels alias `"server-only"` to an empty stub module (`src/test-support/empty-module.ts` in Linear, `test-support/server-only-stub.ts` in dollar-pixels) via `fileURLToPath(new URL(...))` — explicitly *not* `URL.pathname`, because the repo path contains a space. Linear adds `testTimeout: 30_000, hookTimeout: 30_000` for PGlite cold-boot. dollar-pixels pins `env: { STORE_DRIVER: "memory" }` so unit tests never touch the SQLite file.

**vitest.setup.ts** — all three nearly identical: import `@testing-library/jest-dom/vitest`, `afterEach(cleanup)`, a shared `next/navigation` mock (`routerMock` with push/replace/back/forward/refresh/prefetch, `usePathname`, `useSearchParams`, `useParams`, `redirect`, `notFound`), then jsdom shims for `matchMedia`, `ResizeObserver`, `IntersectionObserver`, `Element.prototype.scrollIntoView`. Linear's is the most elaborate (also stubs `hasPointerCapture`/`setPointerCapture`/`releasePointerCapture` for its keyboard-driven list).

**playwright.config.ts** — each defines its own `PORT` (`process.env.PORT ?? <n>`) specifically to avoid colliding with sibling apps' stray dev servers — every config has a comment to this effect (*"a stray `next dev` from one of the others holds :3000 often enough that it has already happened"*). super-smash/dollar-pixels use port 3000 and `webServer.command: "pnpm run dev -- --port ${PORT}"`. **Linear uses port 3100 and builds+starts a production server instead** (`pnpm run build && pnpm run start -- --port ${PORT}`, `timeout: 600_000`) specifically to avoid Turbopack's lazy dev-compile flakiness, and sets env vars in `webServer.env` to pin the DB driver for e2e (see §2). All projects: `fullyParallel: false, workers: 1, forbidOnly: !!process.env.CI, retries: process.env.CI ? 2 : 0, reporter: "html"`. Viewport differs by app (Linear 1440×900 desktop-only "three-pane app"; super-smash 1280×720 desktop-chrome only, no mobile project, "two-players-one-keyboard game"; dollar-pixels adds a `mobile-chrome` (Pixel 7) project because it has a responsive downscale path).

**.gitignore** — root `Replicates/.gitignore`:
```
.playwright-mcp/
.superpowers/
super-smash/anim-*.png
.vercel
.env*
```
Per-project `.gitignore` (Linear/super-smash/dollar-pixels near-identical): `node_modules/`, `.next/`, `out/`, `build/`, `coverage/`, a `.data/`/`*.db*` block for local SQLite/PGlite data with a comment about it being local-only, `test-results/`, `playwright-report/`, `blob-report/`, `.playwright-mcp/`, `*.tsbuildinfo`, `.env`, `.env.local`, `.env*.local`, `.DS_Store`, `.vercel`. Linear additionally ignores `research/screenshots/linear-app-*` (sanitized-vs-raw screenshot distinction, documented inline).

**.env.example** — each app leads with a comment block establishing the zero-config promise (e.g. dollar-pixels: *"Every variable here is optional. With an empty environment the app runs fully"*; super-smash: *"Super Smash runs with an empty environment. There is nothing to configure"*). Variables are grouped under `# --- section ---` headers, each documented with what it defaults to and why, and dangerous choices (e.g. `PAYMENT_PROVIDER=stripe` without keys) are called out as fatal-not-silent.

**pnpm-workspace.yaml** — NOT a real monorepo link between projects (there is no root `package.json` or root `pnpm-workspace.yaml`). Each project's own file just declares pnpm's build-approval list, e.g. Linear/super-smash: `allowBuilds:\n  unrs-resolver: true`; dollar-pixels additionally lists `esbuild`. Add one identical file per new project.

---

## 2. Persistence pattern (Linear = the newest/best reference; dollar-pixels for comparison)

**Ports** — `Linear/src/ports/repositories.ts` and `Linear/src/ports/ai.ts`: pure interfaces in domain vocabulary, no SQL, e.g. every mutation method takes an optional trailing `Tx` (an erased-at-build-time type alias for the DB port's executor) so repositories compose atomically inside `db.transaction()`. dollar-pixels equivalent: `dollar-pixels/src/ports/index.ts` — a flatter single file with `Clock`, `IdGen`, `AuthProvider`, `Store` interfaces (comment: *"Every one of these exists because the obvious direct implementation is wrong somewhere that matters"*).

**adapters/db/driver.ts** (`Linear/src/adapters/db/driver.ts`) — defines the shared `SqlExecutor`/`SqlDatabase`/`SqlValue`/`SqlRow`/`SqlEngine` types and a hand-rolled `splitStatements()` SQL-script splitter (respects string literals, `$tag$`-quoted blocks, comments). Big rationale comment on **why PGlite, not SQLite** (unlike dollar-pixels' SQLite-for-dev choice): *"SQLite's default BINARY collation is byte-wise; Postgres' default ICU collation folds case... PGlite is Postgres compiled to WASM — the same parser, planner and collation."*

**adapters/db/pglite.ts** — local/default adapter. Loads `@electric-sql/pglite` via a *variable* dynamic import specifier (`await import(/* webpackIgnore: true */ specifier)`) so bundlers don't follow it. Memoizes the open promise; `dataDir === ":memory:"` for tests, a real path for dev. Implements `transaction()` with an `AsyncLocalStorage`-based nesting guard plus a promise queue serializing independent transactions — PGlite is single-connection, so concurrent `transaction()` calls must queue rather than interleave. `migrate()` applies `schema.sql` idempotently via `splitStatements`.

**adapters/db/neon.ts** — deployed adapter, `@neondatabase/serverless`, dynamically imported. Sets `neonConfig.poolQueryViaFetch = true` (single statements over HTTP); falls back to importing `ws` for the WebSocket constructor if absent. `transaction()` opens a real `pool.connect()` client and binds an `SqlExecutor` to it.

**adapters/db/index.ts** — the composition point. `getDb()` picks `NeonDatabase` vs `PgliteDatabase` from `config().db.driver`, memoized on `globalThis` via `Symbol.for("linear-clone.db")` — **not** a module-level `let`, because *"Next builds several module graphs per app... a module-scoped singleton is a singleton per graph, not per process."* Also exports `setDbForTests`/`resetDbForTests`.

**Driver selection** — `Linear/src/config/env.ts`, function `build()`: `const driver = oneOf<DbDriver>("DB_DRIVER", DB_DRIVERS, url ? "neon" : "pglite")` — presence of `DATABASE_URL` is the signal, `DB_DRIVER` can force it. Unknown enum values throw (not silently fall back) — contrasted explicitly against dollar-pixels' older bug: *"A wrong value is a boot failure, never a fallback. The sibling project `dollar-pixels` learned this the expensive way."*

**Production guard** — same file: `if (isProduction && driver === "pglite" && !allowsPgliteUnderProduction()) throw new Error(...)`. `allowsPgliteUnderProduction()` requires an explicit `E2E_ALLOW_PGLITE_PRODUCTION_BUILD=true` env var **and** `!isServerless()`, where `isServerless()` checks a list of `SERVERLESS_MARKERS` (`VERCEL`, `AWS_LAMBDA_FUNCTION_NAME`, `NETLIFY`, `RENDER`, `FLY_APP_NAME`, `K_SERVICE`, `FUNCTION_TARGET`, `FUNCTIONS_WORKER_RUNTIME`, `CF_PAGES`) so the escape hatch can never fire on a real deployment even if the env var leaks there.

**scripts/db-push.ts** (`Linear/scripts/db-push.ts`) — run by `pnpm run db:push` and by the Vercel build command. Reimplements driver selection and the production guard from scratch (doesn't import `adapters/db` because that dir uses TS parameter properties and `import "server-only"`, both incompatible with `node --experimental-strip-types`). Reads `schema.sql` off disk directly (works at build time, not at request time on Vercel). Applies the whole script in one call per driver; `report()` turns a Postgres error's character `position` into a `schema.sql:<line>` pointer with surrounding context.

**scripts/build-schema.mjs** — generates `src/adapters/db/schema.ts` (a `SCHEMA_SQL` template-literal export) from `src/adapters/db/schema.sql`, because reading the `.sql` file at runtime doesn't survive Vercel bundling. `schema.test.ts` re-derives it and fails if committed output disagrees (drift guard). Runs via `prebuild` script hook.

**Schema SQL location**: `Linear/src/adapters/db/schema.sql` (source of truth) + generated `schema.ts`. dollar-pixels: `src/adapters/store/schema.sql` (Postgres) **and** a separate `schema.sqlite.sql` (SQLite dialect — the thing Linear's design note explicitly says it avoided by choosing PGlite instead of SQLite).

**Seed data on first boot** — `Linear/src/lib/boot.ts` exports `ensureReady()`, memoized on `globalThis` via `Symbol.for("linear-clone.ready")`. Its `boot()`: migrates only if `driver === "pglite"` (Neon already migrated via `db:push` in the build), then if `config().workspace.seedDemoData`, calls `seedDemoWorkspace(db, { hashPassword })` from `Linear/src/lib/seed.ts` (1575 lines — deterministic ids/timestamps via `deterministicId`/base date, explicitly writes raw SQL rather than calling repositories, so it can backdate creation timestamps and survive a rebuild without breaking bookmarked issue numbers like `ENG-4`).

**How e2e pins the driver** — `Linear/playwright.config.ts` `webServer.env`: `DB_DRIVER: "pglite"`, `DB_DATA_DIR: ":memory:"`, `SEED_DEMO_DATA: "true"`, `E2E_ALLOW_PGLITE_PRODUCTION_BUILD: "true"`, `AUTH_SECRET: "e2e-secret-not-for-production-use-only-..."`. Comment: *"a developer who happens to have a real connection string exported would have this suite seed a demo workspace into it and then assert on member removal. Naming the driver makes that impossible."*

**dollar-pixels persistence** — three drivers (`memory` | `sqlite` | `postgres`), not two. `dollar-pixels/src/adapters/store/index.ts`: `storeDriver()` reads `STORE_DRIVER` (default `"sqlite"`), throws on unrecognized values (the exact bug class Linear's env.ts comment references). `getStore()` memoizes all three adapters on one `globalThis` registry (`storeRegistry()`), throws if `postgres` selected without `DATABASE_URL`. `dollar-pixels/vercel.json`:
```json
{ "functions": { "src/app/api/**/*.ts": { "maxDuration": 60 } } }
```
(Neither Linear nor super-smash has a `vercel.json` at all — Vercel zero-config detection is sufficient for them.)

---

## 3. Game architecture pattern (super-smash)

**Layer separation** (`super-smash/src/{engine,game,render}`):
- `src/engine/` — the pure simulation (`simulate.ts` exports `step(state, inputs)`, plus `physics.ts`, `knockback.ts`, `hitbox.ts`, `projectile.ts`, `states.ts`, `fixed.ts` for Q12 fixed-point math, `hash.ts` for desync detection, `constants.ts`, `types.ts`). Doc comment on `simulate.ts`: *"`step(state, inputs)` — the one door into the simulation. Everything above this file... calls this and reads what comes back; nothing above it may reach in and change a fighter."* Frame-phase order (movement before hit resolution before blast-zone KOs) is explicitly part of the contract — reordering is a desync bug even with correct code on both sides.
- `src/game/` — `bootstrap.ts` (registers fighters/stages into the engine's registry once, idempotently) and `matchRunner.ts` (the seam between pure sim and the browser). `matchRunner.ts` doc comment: *"Everything below this file is deterministic and knows nothing about time, canvases or keyboards; everything above it is presentation... a fixed timestep [at 60Hz]... accumulate real elapsed time, run as many whole 60Hz ticks as fit, and interpolate the render across the remainder."* Exports `FRAME_MS = 1000/60`.
- `src/render/` — pure-function canvas painters (`renderer.ts`, `camera.ts`, `vfx.ts`, `hud.ts`, `skeleton.ts`, `blend.ts`, per-character `chars/<name>/`, `poses/`).

**Enforced layering** — `super-smash/src/engine/layering.test.ts` is the "build-failing test" referenced in the brief: it walks the actual `src/engine` source (not the bundler's import graph), strips comments/strings, and asserts (a) no imports from `render/`, `net/`, `components/`, `app/`, `audio/`, `ai/`, `input/`, `react`, `react-dom`, `next`; (b) no calls to `Math.random`, `Math.sin/cos/tan/pow/exp/log/atan`, `Date.now`, `performance.now`, `new Date`, `crypto.` (one documented exception: `fixed.ts`'s one-time `Math.sin` sine-table builder, pinned by a `SIN_TABLE` marker literal); (c) no reference to `window`, `document`, `localStorage`, `navigator`, `fetch(`, `requestAnimationFrame`, `process.env`. The test also unit-tests its own guard logic (catches a forbidden import/call, doesn't false-positive on comments/strings/URLs).

**Canvas rendering** — `super-smash/src/app/play/page.tsx` (the match screen, `"use client"`). Doc comment: *"A canvas, a loop, and as little React as possible... the game state deliberately never enters React state."* Uses `useRef` for the canvas element and a `MatchRunner` instance (`runnerRef`), not `useState`, to avoid 60Hz React re-renders.

**Store (zustand) connection** — `super-smash/src/lib/matchConfig.ts`: `export const useMatchConfig = create<MatchConfigState>()((set, get) => ({...}))`. This store holds *menu/config* state only (players, stageId, rules, bindings, results) — never the live simulation state. `play/page.tsx` reads slices via `useMatchConfig((s) => s.players)` etc. This is the pattern to copy for island-empire: zustand for UI/session config, plain refs + the pure engine for the 60fps loop.

**Determinism test** — see layering.test.ts above (`super-smash/src/engine/layering.test.ts`).

**E2E driving a canvas game** — `super-smash/e2e/helpers.ts`: routes/keys are *re-declared*, not imported from `src/` (*"an e2e suite that imports the app's own constants cannot tell you the app still works, only that it is self-consistent"*). `readFighters(page)` reads simulation truth via `window.__smashDebug.fighters()` injected debug handle rather than pixel-sampling the canvas (*"pixels can only tell you something was painted... whether the simulation moved"*). `startMatch`/`startMatchFromMenu`/`waitForMatch` walk the real menu flow (no deep links, because match config lives in a client store that a cold `page.goto` wouldn't have). `holdFor(page, code, frames)` holds a key for `frames/60` seconds. `super-smash/e2e/gameplay.spec.ts` asserts fighter *position* moved (not just frame counter advancing) — doc comment explains a real shipped bug where keyboard listeners were never attached and only an assertion on the actual fighter caught it.

**Screenshot capture** — `super-smash/e2e/screenshots.spec.ts`: gated behind `CAPTURE=1` env var (`test.skip(!CAPTURE, ...)`), run via `CAPTURE=1 npx playwright test screenshots --project=desktop-chrome`, writes to `docs/screenshots/<name>.png` via a `shot()` helper. `test.describe.configure({ mode: "serial" })`. Includes a polling helper `waitForBothOnStage()` that waits for a frame where both fighters are alive, grounded, and close together before snapping — avoids capturing an empty/mid-launch frame.

---

## 4. Document conventions

**README.md shape** — headings, super-smash (`super-smash/README.md`): `# Super Smash` → `## Index` (table of every doc/src path with a one-line description) → `## Quick start` → `## The game` → `## Controls` → `## Architecture` → `## Multiplayer` → `## Deploying` → `## Known gaps` → `## What this is`. Linear (`Linear/README.md`): `# Linear` → `## What it does` → `## How it was built` (`### Six research lanes, in parallel`, `### Then seven build slices, in parallel`) → `## Decisions worth knowing` → `## What is verified, and what is not` → `## Code index` (`### Commands`, `### Deploying`). Both open with `> **bold tagline**` right under the H1, then a lead paragraph, then screenshot tables (`| Col | Col |` header row of feature names, then `<img src="docs/screenshots/x.png" width="240" alt="...">` cells with long descriptive alt text), then a **stats line** paragraph, e.g. Linear: *"Next.js 16 · PostgreSQL everywhere (WASM locally, Neon deployed) · **1,559 unit tests** · 23 e2e tests · built from six parallel research lanes, then seven parallel build slices"*.

**SPEC.md** — numbered sections starting at `## 1. Vocabulary`, ending in `## N. Out of scope` or `## N. Testing`. super-smash: `1. Vocabulary, 2. Scope, 3. Architecture (### The simulation contract), 4. Physics and combat, 5. Determinism and netcode, 6. Controls, 7. Roster, 8. Stages, 9. Screens, 10. Visual design, 11. Testing, 12. Out of scope`. Linear: `1. Scope (### In/Out/### The one thing that cannot be replicated), 2. Stack (### Zero-config promise), 3. Persistence (### One dialect two engines/### Manual ordering/### Identifiers/### Category-transition timestamps), 4. Permissions, 5. Design, 6. Interaction, 7. Screens, 8. Verification`. dollar-pixels: `1. Vocabulary, 2. Geometry, 3. Pricing, 4. Page kinds, 5. Buying blocks, 6. Domain model, 7. Architecture (### The two ports that carry the brief), 8. HTTP surface, 9. Rendering the grid, 10. Screens, 11. Visual design, 12. Testing, 13. Out of scope`.

**DECISIONS.md** — `# <Project> — Decision Log` (or `# Decisions` for Linear) then `## D1 — <short imperative title>`, `## D2 — ...` sequentially (dollar-pixels/super-smash use `##`; Linear uses `###` for its D-headings under a plain `# Decisions` H1 — note the numbering is non-contiguous in Linear, e.g. jumps D14→D16, meaning decisions get deleted/renumbered over time, not reused). Titles are full sentences describing the choice and its consequence, e.g. `### D9 — Authorization is one table, proved exhaustive by the compiler`, `## D19 — The engine layering rule is enforced by a test`.

**research/ folder naming** — Linear: `research/01-visual-design.md`, `02-features.md`, `03-data-model.md`, `04-interaction.md`, `05-oss-architecture.md`, `06-stack-deployment.md` (numbered, one per parallel research lane) plus `research/extracted/` and `research/screenshots/`. super-smash: unnumbered, topic-named. dollar-pixels: `original-site.md`, `payments-stripe.md`, `persistence-and-vercel.md`, `prior-art-and-rendering.md`. **island-empire follows Linear's numbered-prefix convention.**

**docs/ folder** — mainly `docs/screenshots/*.png` (the README's images) in all three; super-smash additionally has `docs/character-art.md` (a standalone guide, referenced in its README Index table).

---

## 5. Deployment

**.vercel/project.json** — one per linked project, gitignored. Confirmed names: `Linear/.vercel/project.json` → `"projectName":"linear-david"`; `dollar-pixels/.vercel/project.json` → `"dollar-pixels-david"`; `bet/.vercel/project.json` → `"bet-david"`. All share one `orgId` (`team_BC3HgrHfxsteTwroadm1TaKB`). super-smash currently has **no** `.vercel/project.json` present locally (README references `https://smash-david.vercel.app`), confirming the pattern: `<slug>-david`.

**.vercel/README.txt** — present in `bet/.vercel/README.txt` and `fake-phone/.vercel/README.txt` (boilerplate Vercel CLI text). Auto-managed by the Vercel CLI and not consistently kept.

**vercel.json** — only `dollar-pixels/vercel.json` exists among the three reference apps:
```json
{ "functions": { "src/app/api/**/*.ts": { "maxDuration": 60 } } }
```
Linear and super-smash have none. Add one only if island-empire's API routes need >10s (Hobby default).

**How a subdir becomes its own Vercel project** — each app folder is linked independently via `vercel link` from inside that folder, producing its own `.vercel/project.json`, and each has its own root-level `next.config.ts` with the Turbopack-root pin (§1) so Vercel's build (which runs from that subdirectory as its project root) resolves correctly. There is no top-level Vercel project or turborepo config tying them together. Deploys are manual: `npx vercel deploy --prod --yes` from the subdirectory (no git integration).

**Root .gitignore** — see §1 above.

**Wikipedia subdir — article-per-replica pattern**: Yes. `Wikipedia` is itself a Wikipedia-clone replica app, and it carries an in-universe encyclopedia article about every sibling replica. For Linear specifically, the files are:
1. `Wikipedia/src/content/articles/meta.ts` — exports `linearMeta: ArticleMeta = { slug: projectSlug("Linear"), title: "Linear (replica)", shortDescription: "...", categories: [...], lastEdited: "18 August 2026" }` (one const per article, all in this one file).
2. `Wikipedia/src/content/articles/linear.tsx` — the article body itself: `Hatnote`, `Infobox`, then `<Section heading="Overview">`, `Architecture`, `Development`, `Reception`, `See also`, `References`, and a trailing `<Categories>`. Pulls shared facts from `projects.find((p) => p.slug === "Linear_(replica)")`.
3. `Wikipedia/src/content/projects.ts` — the single source of truth table (`ProjectInfo[]`) with one entry per replica: `name`, `slug`, `tagline`, `replicaOf: {name, url}`, `folder`, `stack: string[]`, `testStats`, `builtWith`, `liveUrl`, `screenshots: string[]`.
4. `Wikipedia/src/content/articles/index.ts` — registers every article into `export const articles: ArticleRegistry = { [linear.meta.slug]: linear, ... }`.
5. A screenshot image at `public/images/<Slug>.png`, referenced by the Infobox.

For island-empire: add a `projects.ts` entry (slug `"Island_Empire_(replica)"`), add `<slug>Meta` to `meta.ts`, write `articles/island-empire.tsx`, register it in `articles/index.ts`, and drop an infobox screenshot into `public/images/`.

---

## 6. Root README.md — per-project section format

Root `Replicates/README.md` starts with a one-line pitch then one `---`-separated section per project, in this shape:

```md
## [ProjectName](folder) — tagline

> **short bold hook line**

One short paragraph: what it is, one-line comparison to the real product.

| Screenshot label | Screenshot label | Screenshot label |
|---|---|---|
| <img src="folder/docs/screenshots/x.png" width="240" alt="descriptive alt text"> | ... | ... |

2-4 paragraphs of "the bet" / interesting technical choices, with **bolded**
key terms and inline `code` for exact numbers/identifiers.

Stack line: Next.js [version] · key differentiator · **N unit tests** ·
M e2e tests · "Built from X parallel research lanes, then Y parallel build
slices[, then Z rounds of codex review]."

**[Read the README →](folder/README.md)** ·
[Spec](folder/SPEC.md) · [Decisions](folder/DECISIONS.md) · [Research](folder/research)

---
```

---

## 7. `.claude/` / CLAUDE.md / AGENTS.md

Only one `.claude/` directory exists, at the repo root (`Replicates/.claude/`), containing `settings.local.json` (WebFetch/WebSearch allow-list) and an empty `scheduled_tasks.lock`. **No `CLAUDE.md` or `AGENTS.md` file exists anywhere in the repo.** None of the siblings has one; island-empire needs none.

---

## Files worth reading directly

1. `Linear/src/adapters/db/index.ts` — `getDb()` composition point, globalThis memoization.
2. `Linear/src/adapters/db/pglite.ts` — PGlite adapter.
3. `Linear/src/config/env.ts` — env validation + production PGlite guard + `SERVERLESS_MARKERS`.
4. `Linear/playwright.config.ts` — port pinning, production-build webServer, e2e env block.
5. `super-smash/src/engine/layering.test.ts` — determinism/layering guard.
6. `super-smash/src/game/matchRunner.ts` — pure sim ↔ browser seam.
7. `super-smash/src/app/play/page.tsx` — canvas game outside React state.
8. `super-smash/e2e/helpers.ts` + `e2e/screenshots.spec.ts` — debug handle + `CAPTURE=1` screenshots.
9. `Linear/README.md`, `super-smash/README.md` — README shape.
10. `Wikipedia/src/content/projects.ts`, `articles/linear.tsx`, `articles/index.ts` — Wikipedia article hook.
