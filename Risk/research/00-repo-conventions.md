# Repo conventions for `Risk` — verified against island-empire, super-smash, Linear, dollar-pixels, Wikipedia, ArtWall, and root

(Codebase reader lane, 2026-10-05. Starts from `island-empire/research/00-repo-conventions.md`, re-verified file by file against
the current tree — every sibling folder listed here was re-read today, not assumed from that prior doc. island-empire is the
closest ancestor: same genre (pure-engine board/strategy game, canvas renderer, hot-seat, AI bots), so its files are the primary
template; super-smash, Linear and ArtWall fill in the multiplayer/persistence picture.)

---

## 1. Project scaffolding

### package.json

Confirmed by reading `island-empire/package.json` and `super-smash/package.json` directly (both current, Oct/Aug 2026):

Scripts, identical core across every sibling:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "typecheck": "tsc --noEmit"
}
```
island-empire (and Linear, dollar-pixels, ArtWall — every app with a database) adds:
```json
"db:push": "node --experimental-strip-types scripts/db-push.ts",
"build:schema": "node scripts/build-schema.mjs",
"prebuild": "node scripts/build-schema.mjs",
"verify": "pnpm run typecheck && pnpm run lint && pnpm run test"
```
super-smash (no persistence at all) has none of the db/`verify` scripts — just the six core ones.

**Pinned versions, read directly off both files (island-empire is the newer pin set — use these for Risk):**
```json
"next": "16.3.0",
"react": "19.2.8",
"react-dom": "19.2.8",
"zustand": "^5.0.15"      // super-smash pins ^5.0.14 — a patch behind; use island-empire's
"tailwindcss": "^4",
"@tailwindcss/postcss": "^4",
"typescript": "^5",
"eslint": "^9",
"eslint-config-next": "16.3.0",
"@playwright/test": "^1.62.1"   // super-smash is behind at ^1.56.1; island-empire's is current
"vitest": "^4.1.10",
"@vitest/coverage-v8": "^4.1.10",
"jsdom": "^30.0.1",
"vite": "^8.2.1",
"vite-tsconfig-paths": "^6.1.1",
"@vitejs/plugin-react": "^6.0.5",
"fast-check": "^4.3.0",
"@testing-library/jest-dom": "^7.0.0",
"@testing-library/react": "^16.3.2",
"@testing-library/user-event": "^14.6.3",
"@types/node": "^20",
"@types/react": "^19",
"@types/react-dom": "^19",
"clsx": "^2.1.1"
```
Island-empire-only (persistence; see §3): `@electric-sql/pglite@^0.5.5`, `@neondatabase/serverless@^1.1.0`, `server-only@^0.0.1`,
`ws@^8.21.3` + `@types/ws@^8.18.1`, `nanoid@^6.0.1`, `zod@^4.4.3`. super-smash-only (networking; see §3): `trystero@^0.25.3`, and
it has **no** persistence deps whatsoever.

**Risk's call:** Risk is turn-based (no 60fps netcode requirement) and will want map-sharing or long-game-state persistence the
way island-empire shares custom maps — so copy island-empire's dependency set wholesale (pin versions exactly as above) rather
than super-smash's. Skip `trystero` unless Risk ends up building real-time play (see §3).

### tsconfig.json

island-empire's (current, byte-for-byte):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
  "exclude": ["node_modules"]
}
```
Use this one (with `noUncheckedIndexedAccess`), not super-smash's older `ES2017`/no-`noUncheckedIndexedAccess` version — a 40+
territory board with adjacency arrays is exactly the kind of indexing code `noUncheckedIndexedAccess` catches real bugs in.

### eslint.config.mjs — byte-identical across every sibling, copy verbatim

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artifacts
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
```

### postcss.config.mjs — identical everywhere

```js
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};
export default config;
```

### next.config.ts — island-empire's, verbatim (this is the load-bearing one to copy)

```ts
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The dev badge floats over the bottom-left corner, which is exactly where
  // the in-game HUD's income/gold column lives. It gets in the way of the game
  // and of its screenshots.
  devIndicators: false,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,

  // PGlite ships a ~3 MB WASM build of Postgres and Neon's driver opens raw
  // sockets; neither survives being traced and re-bundled. Neon must still land
  // in the serverless function, hence the explicit tracing include.
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@neondatabase/serverless/**/*"],
  },

  // Pin Turbopack's inferred workspace root to this package. Without it,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can land
  // on a sibling project's one — this package is a subdirectory of a larger
  // multi-project repo, not its own git root.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
```
Drop `devIndicators: false`'s comment reasoning for Risk's own HUD layout (Risk will have its own thing occupying a corner — a
territory-count panel or dice tray — worth re-checking once the screen is built, but keep the setting). Keep the
`serverExternalPackages` / `outputFileTracingIncludes` block only if Risk ends up using `@neondatabase/serverless` (it should,
for map-state/game-sharing — see §3). If Risk never touches a database, drop that block and the Turbopack-root pin is the only
thing that stays load-bearing.

### vitest.config.mts + vitest.setup.ts

island-empire's config (verbatim):
```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const serverOnlyStub = fileURLToPath(
  new URL("./src/test-support/empty-module.ts", import.meta.url),
);

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```
`fileURLToPath`, not `URL.pathname` — this repo's path (`Personal Projects/Replicates`) has a space in it, and `.pathname`
percent-encodes it, silently breaking the alias. The `src/test-support/empty-module.ts` stub is one line:
```ts
export {};
```
and `30_000` ms timeouts exist specifically because PGlite boots a WASM Postgres per suite — keep them if Risk uses PGlite,
drop them (back to Vitest's 5 s default) if not.

`vitest.setup.ts` (island-empire's, current) — copy verbatim: `@testing-library/jest-dom/vitest` import, `afterEach(cleanup)`, a
shared `next/navigation` mock (`routerMock` with push/replace/back/forward/refresh/prefetch plus `usePathname`/`useSearchParams`/
`useParams`/`redirect`/`notFound`, with `setPathname`/`setSearchParams`/`setRouteParams` test helpers exported), then jsdom shims
for `window.matchMedia`, `ResizeObserver`, `IntersectionObserver`, and `Element.prototype.scrollIntoView` /
`hasPointerCapture`/`setPointerCapture`/`releasePointerCapture`. The pointer-capture shims matter for Risk: dragging armies
between territories or opening a tooltip panel will hit the same jsdom gaps island-empire's editor hit.

### playwright.config.ts — **pick a free port**

Every sibling pins its own `PORT` specifically because a stray `next dev` from another project holds `:3000`. Ports already
claimed, confirmed by reading every sibling's `playwright.config.ts` today:

| Port | Project |
|---|---|
| 3000 (default) | dollar-pixels, super-smash (dev server) |
| 3100 | Linear |
| 3200 | island-empire |
| 3211 | Wikipedia |
| 3400 | youtube |
| 3401 | fl-studio |

**3200 and 3211 are taken; nothing currently claims 3300, 3500, or anything above 3401 except 3400/3401. Use `3300` for Risk.**
(`bet` and `fake-phone` set no `PORT` at all — they fall back to Playwright's default and would collide with dollar-pixels/
super-smash if run at the same time, which is exactly the bug this convention exists to avoid.)

island-empire's config (the right template — it builds+starts, like Linear, rather than `next dev`, because a board-game canvas
screenshot suite benefits from the same "test what deploys" argument Linear's comment makes):
```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3200); // Risk: 3300
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm run build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    env: {
      DB_DRIVER: "pglite",
      DB_DATA_DIR: ":memory:",
      E2E_ALLOW_PGLITE_PRODUCTION_BUILD: "true",
      NEXT_PUBLIC_ISLAND_DEBUG: "1",   // Risk: NEXT_PUBLIC_RISK_DEBUG, or similar
    },
  },
});
```
Both `desktop-chrome` and `mobile-chrome` (Pixel 7) projects — island-empire ships a responsive board (touch pan/zoom/pinch);
Risk almost certainly wants the same if the board is playable on a phone. super-smash, by contrast, is `desktop-chrome` only
because it is a two-player-one-keyboard game with no mobile input story — not Risk's situation.

### .gitignore

Root `Replicates/.gitignore` (confirmed current):
```
.playwright-mcp/
.superpowers/

# Stray capture artefacts from the animation tooling.
super-smash/anim-*.png
.vercel
.env*
```
Per-project (island-empire's, current):
```
node_modules/
.next/
out/
build/
coverage/

# The local PGlite database. It exists to survive a restart on one machine; it
# is not something to share between them.
.data/

test-results/
playwright-report/
blob-report/
.playwright-mcp/
*.tsbuildinfo
.env
.env.local
.env*.local
.DS_Store
.vercel
.env*
```

### .env.example

island-empire's (current, full text) — copy the zero-config framing and the driver-switch comment shape verbatim, substitute the
game name and whatever Risk actually persists:
```
# ---------------------------------------------------------------------------
# Every variable here has a working default. A fresh clone runs with an empty
# environment: `pnpm install && pnpm run dev`. Nothing is required until you
# deploy — and even then only DATABASE_URL, and only for sharing custom maps.
# The game itself (campaign, random maps, hot-seat, editor drafts) runs
# entirely in the browser and keeps progress in localStorage.
# ---------------------------------------------------------------------------

# --- persistence -----------------------------------------------------------

# Which engine to use: `pglite` | `neon`. Both are Postgres.
#
#   pglite — Postgres compiled to WebAssembly, running in-process against a
#            local directory. The default when DATABASE_URL is unset, and
#            refused in production because its storage does not survive a
#            serverless invocation.
#   neon   — hosted Postgres. What a deployment uses. Selected automatically
#            when DATABASE_URL is set.
# DB_DRIVER=pglite

# Where PGlite keeps its data, relative to the project root.
# DB_DATA_DIR=.data/island-empire

# Neon (or any Postgres) connection string. Setting this selects `neon`.
# DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

### pnpm-workspace.yaml — one identical file per project (not a real monorepo link)

```yaml
allowBuilds:
  unrs-resolver: true
```
There is no root `package.json` or root `pnpm-workspace.yaml` tying the sibling projects together — confirmed: `ls
"Replicates"` has no root `package.json`. Each project is wired to Vercel independently (§6).

---

## 2. Game architecture pattern (island-empire is the template; super-smash's layering test is the same idea for a different genre)

### The engine: a pure `apply(state, action)` function

`island-empire/src/engine/index.ts` is the published contract. Read it directly — it is short and is exactly the shape Risk's
engine should take:
```ts
export * from "./types";
// ... imports from ./ai, ./generator, ./moveZone, ./reducer, ./rules, ./serialize, ./state, ./validate

export function createInitialState(map: MapDefinition, seed: number, options?: InitialStateOptions): GameState { ... }

/** The one door into the rules: validates and applies one action. */
export function apply(state: GameState, action: Action): ApplyResult {
  return applyImpl(state, action);
}

export function legalMoveZone(state: GameState, from: TileCoord): TileCoord[] { ... }
export function legalBuildZone(state: GameState, item: BuyItem): TileCoord[] { ... }
export function defenceNumber(state: GameState, at: TileCoord): number { ... }
export function provinceAt(state: GameState, at: TileCoord): Province | null { ... }
export function isGameOver(state: GameState): boolean { return state.outcome !== null; }
export function aiTakeTurn(state: GameState, playerIndex: number, seed: number): { actions: Action[]; nextSeed: number } { ... }
export function generateRandomMap(options: GeneratorOptions, seed: number): MapDefinition { ... }
export function validateMap(map: MapDefinition): { valid: boolean; errors: string[] } { ... }
export function serializeState(state: GameState): string { ... }
export function deserializeState(json: string): GameState { ... }
```
`src/engine/reducer.ts`'s `apply()` is a `switch` over `action.type` (`MOVE` / `BUY` / `UNDO` / `END_TURN` for island-empire;
Risk's equivalent is more like `REINFORCE` / `ATTACK` / `FORTIFY` / `TRADE_CARDS` / `END_TURN` / `END_PHASE`). The pattern that
matters: **every branch validates first and returns `{ state: input, events: [], error }` on a rule violation — nothing in the
reducer throws for an illegal action.** Legal transitions build through an immutable "draft" helper (`openDraft`/`setTile`/
`setProvince`/`closeDraft` here) and push typed `events` (`{ type: "moved", ... }`, `{ type: "captured", ... }`, etc.) that the
session runner later turns into animations — Risk's reducer should emit its own event union (`{ type: "diceRolled", ... }`,
`{ type: "territoryCaptured", ... }`, `{ type: "cardAwarded", ... }`) for the same reason.

### The layering test — copy this file's *shape*, not its exact banned-list

`island-empire/src/engine/layering.test.ts` (214 lines, read in full) is the build-failing guard referenced in the brief. It:
1. Walks `src/engine/**/*.ts(x)` off disk (not the bundler graph).
2. Strips comments and string literals first (`stripCommentsAndStrings`), so the test's own banned-word list can't trip itself.
3. Asserts no import of `BANNED_PACKAGES = ["react", "react-dom", "next", "zustand", "zod"]`.
4. Asserts no import of a sibling layer by first path segment: `BANNED_LAYERS = ["render", "game", "components", "app",
   "ports", "adapters", "content", "config", "lib"]` — Risk's list will be the same, minus/plus whatever top-level dirs Risk
   actually has.
5. Asserts no relative import escapes `src/engine/` altogether (`escapesEngine`).
6. Asserts no call to `BANNED_CALLS = ["Math\\.random", "Date\\.now", "performance\\.now", "new Date", "crypto\\."]` — **this
   one is non-negotiable for Risk**: dice rolls must go through a seeded PRNG (island-empire's `src/engine/prng.ts` — `next()`/
   `chance()`/`pick()` over a `seed: number`), never `Math.random()`, or replay/undo/AI-vs-human determinism all break.
7. Asserts no reference to `window`, `document`, `localStorage`, `navigator`, `fetch(`, `requestAnimationFrame`, `process.env`.
8. The guard also unit-tests itself (catches a forbidden import, doesn't false-positive on a comment/string).

super-smash's `src/engine/layering.test.ts` is the same idea for a real-time fighter (bans `Math.sin/cos/tan/pow/exp/log/atan`
too, because its physics needs a precomputed sine table, not a live one) — read it for the general pattern, but island-empire's
is the nearer match for a turn-based game with no trig.

### The session runner: `src/game/session.ts` — the seam between pure engine and browser

island-empire's `createSession()` (783 lines, read in full) is the single best file to copy the *shape* of for Risk. Structure:
- Holds `GameState` in a closure variable (not React state, not even a ref inside a component — a plain module-level factory
  function `createSession(options: SessionOptions): Session`).
- Mirrors UI-observable slices into a `zustand/vanilla` `createStore<SessionUiState>()` — selection, lit/legal-move zone,
  shop/action-mode, banner text, tutorial step, `actingPlayer`, `aiPlaying`, `handOff`, `gameOver`, `modal`, toast, settings.
  **`GameState` itself never enters the store or React state** — only derived UI bits do, dispatched via `set()`.
- Every mutation goes through `dispatch(action)` → `engine.apply(state, action)`; on success, re-sets `state`, bumps a `version`
  counter (so React/canvas know to re-render), feeds `result.events` to `handleEvents()` (which enqueues animations), and
  persists via `save()` (an injected callback — island-empire's wraps `localStorage`; see §4).
- `EngineApi` (`src/game/engineApi.ts`) is a 6-method interface wrapping the real `@/engine` module, so tests can inject a
  scripted engine:
  ```ts
  export interface EngineApi {
    createInitialState(map, seed, options?): GameState;
    apply(state, action): ApplyResult;
    legalMoveZone(state, from): TileCoord[];
    legalBuildZone(state, item): TileCoord[];
    defenceNumber(state, at): number;
    provinceAt(state, at): Province | null;
    aiTakeTurn(state, playerIndex, seed): { actions: Action[]; nextSeed: number };
  }
  export const engine: EngineApi = realEngine;
  ```
  Risk's equivalent would expose whatever its reducer needs externally — `legalAttackTargets`, `legalFortifyMoves`,
  `cardTradeValue`, `aiTakeTurn`, etc.
- `SessionOptions` takes injected `now()`, `schedule()` (a `(fn, ms) => cancel` timer, defaulted to real `setTimeout` but
  swappable for a synchronous test scheduler), `skipAnimations`, and a `resume?: SavedSession | null` for autosave.

### Hot-seat ("pass the device") — the exact mechanism to copy

Session-side (`src/game/session.ts`):
```ts
const humanSeats = state.players.filter((p) => p.kind === "human").map((p) => p.index);
const hotSeat = humanSeats.length >= 2;
```
On `END_TURN`, `afterTurnEnd()` branches:
```ts
function afterTurnEnd(): void {
  const idx = state.activePlayerIndex;
  if (state.outcome) return;
  if (!isHumanSeat(idx)) { runAiTurn(idx); return; }
  if (hotSeat) {
    set({ handOff: { player: idx }, hidden: true, actingPlayer: idx });
    return;
  }
  beginHumanTurn(idx);
}
```
UI-side: `src/components/setup/HandOffOverlay.tsx` (read in full, 76 lines) — a full-screen, opaque, colour-tinted modal:
```tsx
export interface HandOffOverlayProps {
  playerName: string;
  colour: PlayerColour;
  onContinue: () => void;
}
```
It is **purely presentational** — "never dismisses itself or touches game state... the caller is responsible for hiding the
overlay and resuming play" (its own doc comment). The board stays rendered but `hidden: true` behind it until `CONTINUE` is
tapped, which calls `session.continueHandOff()` → `beginHumanTurn(h.player)`. For Risk (up to 6 players, not 8, but the same
mechanic): copy this component and the `hotSeat`/`handOff` state machine directly — rename the colour vocabulary to Risk's
(classic six: red/blue/green/yellow/purple/black or whatever the licensed palette turns out to be).

### AI turns — the exact mechanism to copy

Engine side: `aiTakeTurn(state, playerIndex, seed): { actions: Action[]; nextSeed: number }` is **pure** — it returns a whole
turn as an ordered `Action[]` ending in `END_TURN`, never mutates, and is itself just more calls through `apply()` (every
candidate move is validated by actually running it; illegal ones are dropped). island-empire's `src/engine/ai/index.ts` is a
difficulty-gated greedy heuristic (`Easy`/`Normal`/`Hard`) — Risk's AI will have a structurally similar two-phase shape (an
allocate-reinforcements phase, then an attack-or-not phase per territory), same "validate every candidate through `apply`,
drop what's rejected" discipline, same per-seat `Difficulty` field.

Session side: `runAiTurn(idx)` (in `session.ts`) replays the AI's action list one at a time on a timer, not all at once, so the
human watches it happen:
```ts
export const AI_STEP_MS = 300;
export const AI_TURN_BUDGET_MS = 4000;
export const AI_STEP_MIN_MS = 40;

export function aiStepMs(actionCount: number): number {
  return Math.max(AI_STEP_MIN_MS, Math.min(AI_STEP_MS, Math.floor(AI_TURN_BUDGET_MS / Math.max(1, actionCount))));
}
```
300 ms/action while short, compressing toward 40 ms/action so a 60-action turn still finishes in ~4 s — directly reusable for
Risk's AI turns, which can be long (many territory attacks per turn in the late game).

### Canvas rendering kept outside React state — the exact mechanism to copy

`src/components/game/GameCanvas.tsx` (138 lines, read in full): one `<canvas>`, one `useRef` (not `useState`) for the element,
one `useEffect` that sets up a `requestAnimationFrame` loop, an input binding (`attachInput` from `src/game/input.ts` — a pure
`GestureTracker` class classifying tap/pan/pinch, unit-tested without a DOM, plus a thin `attachInput()` browser binding around
it), and a `ResizeObserver`. The loop only repaints when something changed:
```ts
const loop = (now: number) => {
  raf = requestAnimationFrame(loop);
  const active = session.tick(now);
  const bucket = reduced ? 0 : Math.floor(now / 500);   // a slow "ambient" tick (water/bob animation)
  const dirty = session.takeDirty();
  if (!dirty && !active && bucket === lastBucket) return;
  lastBucket = bucket;
  const ui: RenderUi = { selected: s.selected, litZone: s.litZone, /* ...derived UI state... */ };
  render(ctx, session.state, ui, session.camera, now);
};
```
`render()` itself (`src/render/renderer.ts`) is a pure function of `(ctx, state, ui, camera, now)` — no React anywhere in
`src/render/`. `PlayPage.tsx` is the React shell around all this: it loads the map, resumes an autosave, constructs the
`Session`, and mounts `<GameScreen>` (which mounts `<GameCanvas>` plus the HUD). **The live `GameState` never touches a React
`useState` — every 60fps tick bypasses React's render cycle entirely.** This is the one rule to copy exactly for Risk: a
hex/territory map painted every frame from `apply()`'s output must not go through React state, or clicking a territory will
visibly lag behind a re-render.

---

## 3. Online/multiplayer precedents, and their actual cost on Vercel Hobby

Three live patterns exist in the repo. None of them is "the" answer for Risk — pick based on what Risk's online mode (if any)
actually needs.

### Pattern A — WebRTC P2P via trystero (super-smash)

`super-smash/src/net/` (read: `transport.ts`, `packet.ts`, `rollback.ts`, `adapters/{webrtc,broadcast,loopback}.ts`): a
`Transport` interface with three adapters — `webrtc.ts` wraps `trystero` for real cross-machine P2P, `broadcast.ts` uses
`BroadcastChannel` for same-machine multi-tab testing, `loopback.ts` for unit tests. `rollback.ts` does rollback netcode
(client-side prediction + resimulation) because a fighting game needs frame-perfect sync.

**Cost on Vercel Hobby: effectively zero**, and that is the whole point of this pattern — trystero does WebRTC signaling
through a public, free broker (BitTorrent/Nostr/Firebase trackers depending on config), and once two peers are connected the
game traffic is a direct peer-to-peer data channel. **No persistent server process is ever needed**, which matters because
Vercel serverless functions cannot hold a long-lived WebSocket connection open — a Hobby (or Pro) serverless function is
request/response, with execution time limits (10 s default on Hobby, extendable per-route up to a cap), and it cannot act as a
signaling relay itself without an external service.

**Reusable for Risk:** the `Transport` interface and the three-adapter pattern (webrtc / broadcast-for-testing / loopback-for-
unit-tests) is directly reusable if Risk wants real-time online play. But Risk's turns are discrete and slow (reinforce, several
attacks, fortify — seconds to minutes per turn, not 60fps) — rollback netcode is almost certainly overkill. A much lighter
custom-event-passing layer over the same trystero transport (send one `Action` at a time, no rollback) would be the right-sized
version of this pattern.

### Pattern B — PGlite (local) + Neon (deployed) via `getDb()` (island-empire, Linear)

Already the right pattern for **async, turn-based shared state** — i.e., most plausible shapes of "Risk online." See
`island-empire/src/adapters/db/index.ts` (read in full):
```ts
const REGISTRY = Symbol.for("island-empire.db");
export function getDb(): SqlDatabase {
  const existing = registry()[REGISTRY];
  if (existing) return existing;
  const { db } = config();
  const database = db.driver === "neon" ? new NeonDatabase(db.url!, SCHEMA_SQL) : new PgliteDatabase(db.dataDir, SCHEMA_SQL);
  registry()[REGISTRY] = database;
  return database;
}
```
Memoized on `globalThis` via `Symbol.for(...)`, **not** a module-level `let` — the doc comment explains why: "Next builds
several module graphs per app... a module-scoped singleton is a singleton per graph, not per process," and with PGlite that
means multiple WASM Postgres instances against one data directory corrupting its WAL. `src/config/env.ts` picks the driver
(`DATABASE_URL` present → `neon`; otherwise `pglite`), throws (never silently falls back) on an unrecognized `DB_DRIVER`, and
refuses `pglite` under `NODE_ENV=production` unless an explicit e2e escape hatch is set *and* no `SERVERLESS_MARKERS` env var
(`VERCEL`, `AWS_LAMBDA_FUNCTION_NAME`, etc.) is present — so the escape hatch can never fire on a real deployment.
`scripts/db-push.ts` re-implements driver selection standalone (can't import `adapters/db` — `server-only` + TS parameter
properties don't survive `node --experimental-strip-types`), reads `schema.sql` off disk, and is wired into Vercel's build via
`island-empire/vercel.json`:
```json
{ "buildCommand": "pnpm run db:push && pnpm run build" }
```
(This file exists on island-empire specifically — it was not in earlier research of Linear/super-smash, and it is the exact
shape Risk should copy if Risk persists any server-side state: map-sharing, saved games, or multiplayer match state.)

**Cost on Vercel Hobby:** fine. Each request is a short-lived serverless invocation that opens (or reuses, within the same
warm instance) a Neon connection over HTTP (`neonConfig.poolQueryViaFetch = true`, no raw TCP needed for simple queries) and
returns. Neon's free tier plus Vercel Hobby's function limits comfortably cover "save/load a game state" or "poll for the
current match state" traffic. What this pattern does **not** give you is realtime push — there is no persistent connection
back to any client.

### Pattern C — Neon + client polling, no realtime layer at all (ArtWall)

ArtWall (`/Users/fobrizzlemynizzle/Documents/Personal Projects/ArtWall`) is the closest precedent for "everyone sees the same
shared state, but updates can lag a couple of seconds." Its README states the mechanism plainly: *"Drawing is saved through
`POST /api/wall/strokes` and `POST /api/wall/texts`. The homepage polls `/api/wall` so new marks show up without a refresh."*
`lib/db/server.ts`'s header comment is explicit about the history here: *"The original deployment used Supabase; that project
no longer exists... Realtime is polling from the client rather than a Supabase channel."* The client
(`components/wall/art-wall.tsx`) does:
```ts
useEffect(() => {
  const poll = window.setInterval(() => {
    void loadWall(activeWall, loadRequestRef.current, true);
  }, 2500);
  const handleVisibility = () => {
    if (document.visibilityState === "visible") void loadWall(activeWall, loadRequestRef.current, true);
  };
  document.addEventListener("visibilitychange", handleVisibility);
  return () => { window.clearInterval(poll); document.removeEventListener("visibilitychange", handleVisibility); };
}, [activeWall]);
```
— a 2.5 s `setInterval`, plus an immediate re-poll on tab-visibility-regained (covers the common "switched away and back"
case without needing a faster poll). `lib/api/wall.ts`'s `fetchWall()` always passes `cache: "no-store"`.

**Cost on Vercel Hobby:** this is the cheapest realtime-ish option that still works within serverless constraints — no
websocket, no SSE (Server-Sent Events would require holding a function open for the connection's lifetime, which **does not
work** on Vercel serverless at all: a Hobby function has a hard execution-time ceiling, so an SSE stream gets cut mid-flight).
Polling costs one short Neon query every `interval` per connected client; at Risk's table sizes (2–6 players, not a public
wall with arbitrary concurrent visitors) this is trivial even on free tiers. The tradeoff is latency (2–5 s to see another
player's move) and some wasted "nothing changed" queries — acceptable for a turn-based board game where a human is reading
the board between actions anyway.

**ArtWall's deployment note, for completeness:** its `.vercel/project.json` project name is `"art-wall"` — no `-david` suffix,
an exception to the naming convention in §6 (reads as pre-dating that convention, since its own README references a
"legacy Supabase" era and a since-deleted project).

### Recommendation for Risk, given what's in the repo

Risk's base requirement (pass-and-play + AI bots, per the brief) needs **none of this** — it's single-browser-tab, in-memory/
localStorage state, same as island-empire's hot-seat mode with zero network code. If/when Risk gets an online mode, a
turn-based game with 2–6 players and no per-frame sync requirement is best served by **Pattern C's shape (Neon + short poll,
or even simpler: poll only while it's not your turn, stop polling once it is)**, built on **Pattern B's `getDb()`/driver-
selection scaffolding** (reuse `config/env.ts` and `adapters/db/index.ts` wholesale) rather than Pattern A's WebRTC/rollback
machinery, which solves a problem (sub-frame desync) Risk does not have.

---

## 4. Persistence of local progress (localStorage patterns)

Three island-empire files to copy the shape of directly (all guarded identically: `try { ... } catch { /* storage unavailable
— feature simply doesn't persist */ }`, `typeof window !== "undefined"` checks for SSR safety):

**`src/ports/settings.ts`** (the interface) + **`src/adapters/localStorage/settings.ts`** (the implementation):
```ts
export interface Settings { oneClickMove: boolean; music: boolean; sound: boolean; }
export const DEFAULT_SETTINGS: Settings = { oneClickMove: false, music: true, sound: true };
export interface SettingsPort {
  read(): Settings;
  write(next: Settings): void;
  subscribe(listener: (settings: Settings) => void): () => void;
}
```
Key: `"island-empire:settings:v1"` — **the `:v1` suffix is the convention**: bump it if the shape ever changes incompatibly,
rather than migrating. The adapter keeps a module-level `Set` of `listeners` so every open tab/component reacts to a write.

**`src/ports/localProgress.ts`** + **`src/adapters/localStorage/progress.ts`** — campaign-style progress tracking:
```ts
export interface Progress {
  levels: Record<string, LevelProgress>;         // Risk: maybe per-scenario or per-map records
  challengeMedals: Record<string, Difficulty[]>; // Risk: maybe weekly-challenge equivalent, if any
  deviceId: string;                              // crypto.randomUUID(), falls back to Math.random()-based id if unavailable
}
```
Key: `"island-empire:progress:v1"`.

**`src/game/autosave.ts`** — resumable in-progress game, keyed by everything that shapes the initial state so an incompatible
save never resumes wrong:
```ts
export function sourceKey(config: SessionConfig): string {
  switch (config.source.kind) {
    case "campaign": return `campaign:${source.levelId}:${config.difficulty}`;
    case "custom": return `custom:${source.mapId}:${config.difficulty}`;
    // ...
  }
}
```
Key prefix: `"island-empire:session:v1:"`. `loadSaved`/`storeSaved` validate the parsed shape minimally (`parsed?.state?.tiles`)
before trusting it. **For Risk**: the equivalent key would need to encode the map/scenario, the seat configuration (who's AI,
who's human, difficulty), and probably the player count — anything that changes what a resumed `GameState` even means.

---

## 5. Document conventions

### README.md shape

island-empire's own README (read in full) is the nearest-genre template: `# <Project>` → `> **bold one-line hook**` → one lead
paragraph (what it is, source, comparison to the real thing) → two 3-image screenshot tables (`| Col | Col | Col |` header row
of short labels, `<img src="docs/screenshots/x.png" width="240" alt="long descriptive alt text">` cells) → 3–4 bold-led
paragraphs about the interesting technical bets ("**The game is a square grid, not a hex grid.**", "**Every number was
measured...**", "**The engine is a pure function and a test proves it.**") → a stats line. super-smash's README additionally
has an `## Index` table of every doc/src path up top, and ends with `## Known gaps` / `## What this is` — worth keeping for
Risk given how many rules-interpretation calls a Risk clone will also have to make and disclose (classic Risk has notoriously
ambiguous/house-ruled mechanics — fortifying chains, card trade-in escalation, blank/wild cards, Risk vs. "Risk II"/digital
editions). Both open with the screenshot tables before the "the bet" paragraphs.

### SPEC.md — island-empire's own section list is the direct template for a board/strategy game

```
## 1. Vocabulary
## 2. Scope
## 3. Rules
## 4. Architecture
## 5. Data flow
## 6. HTTP surface
## 7. Screens
## 8. Visual design
## 9. Controls
## 10. Efficiency plan
## 11. Testing
## 12. Work-stream decomposition
## 13. Out of scope
```
(super-smash and dollar-pixels use the same `##`-level heading for every top section; **Linear is the odd one out** with `###`
sub-levels under a few top sections — island-empire does not follow Linear's nesting, and Risk shouldn't either.) Risk's own
§3 "Rules" section will be the single largest and most contentious section, the same way island-empire's §3 was (reverse-
engineered from gameplay footage); expect a "Scope/§2" split between "classic Risk rules" and "which optional/variant rules
this clone implements" the same way island-empire's §2 scopes campaign/random/hot-seat/editor/challenges.

### DECISIONS.md

`# <Project> — Decision Log` (island-empire's own header, confirmed), then sequential `## D1 — <full-sentence title describing
the choice and its consequence>`, never renumbered or reused even if a decision is later superseded (island-empire's own file
runs cleanly D1→D42 with no gaps as of today — Linear's is the one with gaps from historical deletions; dollar-pixels and
super-smash also don't reuse numbers). Example titles, read directly off island-empire's file: `## D1 — The board is a square
grid with 4-neighbour adjacency, not hex`, `## D39 — The Easy AI recruits at most one knight per province per turn`. Every
entry has **Decision.** / **Why.** / **Consequence.** paragraphs. For Risk, expect decisions like "attacker rolls up to 3 dice,
defender up to 2" (classic rule, low ambiguity) sitting alongside genuinely contested ones the way island-empire's D3/D4 label
extrapolated numbers explicitly — Risk's fortifying-chain rule, blank-card handling, and "does eliminating a player hand you
their full hand before or after the end-of-turn trade-in cap" are the kind of calls that belong in DECISIONS.md with their
source cited, not silently assumed.

### research/ folder numbering

island-empire itself uses Linear's numbered-prefix convention: `01-core-rules.md`, `02-modes-maps-editor.md`, `03-ux-flow.md`,
`04-genealogy-slay-antiyoy-engine.md`, `05-visual-design.md`, `06-research-brief.md`, plus this file as `00-repo-conventions.md`
and `research/screenshots/`. **Risk should follow this exactly** — it already has started: `Risk/research/screenshots/store/`
contains 22 Play Store screenshots plus a feature graphic and icon (already gathered by an earlier lane), and an empty
`Risk/research/map-data/` directory (presumably reserved for a parallel lane extracting the classic 42-territory/6-continent
board geometry). This file is `00-`; expect sibling lanes to land as `01-`, `02-`, etc.

### docs/ folder

`docs/screenshots/*.png` for the README's own images (island-empire has 8: `title.png`, `level-intro.png`, `challenges.png`,
`editor.png`, `random-setup.png`, `match.png`, `overworld.png`, `strength-chart.png`) — **note this is a different directory
from `research/screenshots/`**, which holds raw reference material (store screenshots, video frames) used *during* research,
not the finished app's own screenshots. Risk's `docs/screenshots/` directory already exists (empty) at
`Risk/docs/screenshots/`; it gets populated once there's a running app to capture.

### e2e screenshot capture gated by `CAPTURE=1`

Both `island-empire/e2e/screenshots.spec.ts` and `super-smash/e2e/screenshots.spec.ts` (read in full) share the exact pattern:
```ts
const CAPTURE = process.env.CAPTURE === "1";
test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE, "Screenshot capture only runs with CAPTURE=1");
const shot = (name: string) => `docs/screenshots/${name}.png`;
```
Run via `CAPTURE=1 npx playwright test screenshots --project=desktop-chrome` (island-empire additionally runs a
`--project=mobile-chrome` pass, suffixing mobile shots with `-mobile`: `shot("title", "mobile-chrome") → "title-mobile.png"`).
Both files include a polling helper that waits for a *photographable* moment rather than a fixed delay — island-empire's
`waitForBothOnStage`-equivalent pattern reads actual game-state truth (`readFighters`/`readState` via an injected debug global,
not pixel-sampling the canvas) before snapping, specifically to avoid capturing an empty board or a mid-animation frame. For
Risk: wait for something like "dice have resolved and both armies counts updated" before snapping a combat screenshot, not a
fixed `waitForTimeout`.

### Root README.md — per-project section format

Confirmed current, `Replicates/README.md`'s Island Empire section (quoted in full above the `---`):
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
Sections run, in current file order: Island Empire, FL Studio, Linear, super-smash, fake-phone, bet, dollar-pixels, youtube —
not alphabetical and not strictly by build date; new sections appear to get added wherever, so there's no fixed insertion
point to match. Add Risk's section the same shape, wherever makes sense once it exists.

### Wikipedia sibling — confirmed island-empire's hook exists; copy its exact shape for Risk

All four files read directly, current:
1. **`Wikipedia/src/content/projects.ts`** — the single source-of-truth `ProjectInfo[]` table. island-empire's entry:
   ```ts
   {
     name: "Island Empire",
     slug: "Island_Empire_(replica)",
     tagline: "...",
     replicaOf: { name: "Island Empire", url: "https://play.google.com/store/apps/details?id=com.hbrz.wodan" },
     folder: "island-empire",
     stack: [...],
     testStats: "...",
     builtWith: "...",
     liveUrl: "https://island-empire-david.vercel.app",
     screenshots: [
       "island-empire/docs/screenshots/overworld.png",
       "island-empire/docs/screenshots/match.png",
       // ...
     ],
   }
   ```
2. **`Wikipedia/src/content/articles/meta.ts`** — one `const` per article: `export const islandEmpireMeta: ArticleMeta = {
   slug: projectSlug("Island Empire"), title: "Island Empire (replica)", shortDescription: "A browser rebuild of the mobile
   territory game Island Empire", ... }`, registered into a trailing array.
3. **`Wikipedia/src/content/articles/island-empire.tsx`** — the article body (not read in full this pass, but its registration
   confirms the file exists and follows the Linear-article shape documented in the prior conventions lane: `Hatnote`,
   `Infobox`, `<Section heading="Overview">`, Architecture, Development, Reception, See also, References, `<Categories>`).
4. **`Wikipedia/src/content/articles/index.ts`** — `import { islandEmpire } from "./island-empire";` and
   `[islandEmpire.meta.slug]: islandEmpire` in the registry.

**For Risk:** add a `projects.ts` entry (slug `"Risk_(replica)"` or whatever the actual boxed-game title turns out to be, given
trademark/naming — check what island-empire did for its own `replicaOf.name`/`url` framing, since "Risk" the brand is owned by
Hasbro and the mobile port is "RISK: Global Domination" by SMG Studio), a `<slug>Meta` in `meta.ts`, an `articles/risk.tsx`
article body, registration in `articles/index.ts`, and a screenshot at `public/images/<Slug>.png` for the infobox — once Risk
has a live deployment and screenshots to reference.

---

## 6. Deployment

### `.vercel/project.json` naming — `<slug>-david` is the norm, with two confirmed exceptions

Read directly, current, every sibling that has one:
```
island-empire  → "island-empire-david"
Linear         → "linear-david"
dollar-pixels  → "dollar-pixels-david"
bet            → "bet-david"
fake-phone     → "fake-phone-david"
fl-studio      → "fl-studio-david"
Wikipedia      → "davids-wikipedia"      ← exception (prefix form, not suffix)
ArtWall        → "art-wall"              ← exception (no suffix at all; pre-dates the convention per its own README)
```
All (including the exceptions) share one `orgId`: `team_BC3HgrHfxsteTwroadm1TaKB`. **Use `risk-david` for Risk** — the norm,
not either exception.

### vercel.json

island-empire has one (confirmed — this was *not* documented in the prior research lane, which only checked Linear/super-smash/
dollar-pixels and found none there):
```json
{ "buildCommand": "pnpm run db:push && pnpm run build" }
```
This is the file to copy if Risk persists anything server-side (map sharing, saved multiplayer games) — the build runs
`db:push` (idempotent schema migration against whatever `DATABASE_URL` Vercel injects) before `next build`. If Risk ships with
zero server-side persistence, skip `vercel.json` entirely, same as Linear/super-smash/bet/fake-phone/fl-studio, which have
none — Vercel's zero-config Next.js detection is sufficient.

### Deploy mechanism — manual, no git integration

Each app folder is linked independently (`vercel link` from inside the folder, once, producing its own `.vercel/project.json`).
Deploys are manual: `npx vercel deploy --prod --yes` from inside the project's subdirectory. There is no git-triggered deploy
and no root-level Vercel project or turborepo config tying the sibling projects together.

### Neon integration

Set `DATABASE_URL` as a Vercel environment variable on the linked project (same connection string the `.env.example` documents
as optional locally); `scripts/db-push.ts` + the `vercel.json` `buildCommand` apply the schema on every deploy. Confirmed this
is how island-empire does it; ArtWall's `.env.example` documents the exact same `DATABASE_URL` shape, having migrated off
Supabase onto this pattern.

### Memory rule: commit straight to main

Per standing instruction for this repo, `Replicates` commits straight to `main` with no PR/branch flow — confirmed by `git log`
on the repo root showing linear history of direct commits (`docs(wiki): ...`, `wikipedia: ...`, etc.) with no merge-from-branch
pattern beyond an occasional `Merge origin/main`. Risk's own commits should follow the same practice once work begins.

### `.claude/` / CLAUDE.md / AGENTS.md

Still true as of today: only one `.claude/` directory exists, at the repo root (`Replicates/.claude/`), containing
`settings.local.json` and an empty `scheduled_tasks.lock`. No `CLAUDE.md` or `AGENTS.md` exists anywhere in the repo — Risk
needs none either (and `next.config.ts`'s `agentRules: false` keeps it that way even if one briefly existed during
development).

---

## Files worth reading directly

1. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/engine/index.ts` — the engine's public contract.
2. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/engine/reducer.ts` — `apply(state, action)`, draft/events pattern, the MOVE/BUY/UNDO/END_TURN shape to riff Risk's own action set from.
3. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/engine/layering.test.ts` — the purity/determinism guard; copy the shape, retune `BANNED_LAYERS`/`BANNED_CALLS` for Risk's own top-level dirs.
4. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/engine/ai/index.ts` — difficulty-gated greedy AI heuristic, validated-through-apply discipline.
5. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/game/session.ts` — the full session runner: zustand UI store, dispatch/events/animations, hot-seat hand-off state machine, AI turn replay timing (`aiStepMs`), autosave hook.
6. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/game/engineApi.ts` — the narrow `EngineApi` interface pattern for test injection.
7. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/components/setup/HandOffOverlay.tsx` — the hot-seat "pass the device" overlay component, copy near-verbatim.
8. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/components/game/GameCanvas.tsx` — canvas-outside-React-state rendering loop, dirty-flag repaint, input binding.
9. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/game/input.ts` — pure `GestureTracker` (tap/pan/pinch) + thin DOM binding.
10. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/adapters/db/index.ts` + `src/config/env.ts` — `getDb()` globalThis-memoized composition point, driver selection, production PGlite guard.
11. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/vercel.json` — the `db:push && build` buildCommand shape.
12. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/src/adapters/localStorage/{settings,progress}.ts` + `src/game/autosave.ts` — the three localStorage persistence shapes.
13. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/super-smash/src/net/transport.ts` + `src/net/adapters/{webrtc,broadcast,loopback}.ts` — the P2P Transport pattern, if Risk ever adds real-time play.
14. `/Users/fobrizzlemynizzle/Documents/Personal Projects/ArtWall/lib/db/server.ts` + `lib/api/wall.ts` + `components/wall/art-wall.tsx` (2.5 s poll + visibility-regain re-poll) — the Neon-plus-polling shared-state pattern, closest fit for turn-based online Risk.
15. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/e2e/screenshots.spec.ts` + `super-smash/e2e/screenshots.spec.ts` — `CAPTURE=1` gating pattern, state-polling before snapshot.
16. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/README.md`, `SPEC.md`, `DECISIONS.md` — the nearest-genre document shape to copy section-by-section.
17. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/Wikipedia/src/content/projects.ts` + `articles/meta.ts` + `articles/index.ts` — confirmed island-empire's entries; same four touch points for Risk.
18. `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/README.md` — root per-project section format (Island Empire's section quoted above).
