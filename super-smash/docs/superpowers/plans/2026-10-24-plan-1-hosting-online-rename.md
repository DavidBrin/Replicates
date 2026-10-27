# Plan 1 — David-Smash: rename, Cloudflare hosting, online play, gamepad, Vercel remediation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the existing game as **David-Smash** on one free Cloudflare Worker (`https://david-smash.leaders-game.workers.dev`) with working two-player online matches over WebRTC + Cloudflare TURN, gamepads wired into every match, and the old Vercel copy (`smash-david.vercel.app`) taken down with every link switched.

**Architecture:** Next.js builds a static export into `out/`, which the `david-smash` Worker serves as static assets; the Worker runs first only for `/api/*` (TURN credentials at `GET /api/ice`) and `/ws/*` (a per-room SQLite-backed `RoomDO` using the WebSocket Hibernation API, max 2 peers, relaying SDP/ICE and lobby JSON — no tick loop). A new `doSignal` WebRTC adapter implements the existing `Transport` port over one negotiated unreliable DataChannel (id 42), and `matchRunner` drives the existing `RollbackSession` for online matches; the Trystero adapter stays in the tree as an alternate.

**Tech Stack:** Next.js 16.3 (`output: "export"`), React 19, TypeScript 5.9, zustand 5, vitest 4.1 + Testing Library + fast-check, Playwright 1.62 (Chromium), Cloudflare Workers + Static Assets + Durable Objects (SQLite) + Realtime TURN, wrangler 4.146.0, `@cloudflare/workers-types` 5.20261001.1, pnpm 11.

**Spec:** docs/superpowers/specs/2026-10-24-david-smash-design.md

**Conventions for every task**
- `pnpm …` commands run in `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/super-smash`.
- `git …` commands run from the **Replicates root** `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`, with paths relative to it (`super-smash/…`), committing straight to `main` (repo convention). Tasks 25 (David-Internet) is the exception: its git runs from `/Users/fobrizzlemynizzle/Documents/Personal Projects/David-Internet`.
- The full gate is `pnpm typecheck && pnpm lint && pnpm test`. Never `git add -A`; stage the exact paths listed.
- Every commit body ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pushing, deploying, Vercel removal, and anything touching a live site happen only in steps marked **STOP: ask David for go**.
- e2e gates use `PORT=3107 pnpm test:e2e`. Two pre-existing specs were seen to time out on a cold first run and pass on rerun; if a single spec times out once, rerun just that spec (`PORT=3107 pnpm test:e2e <file>`) before treating it as a failure, and report the flake. Never raise timeouts or add retries to pass a gate.

**Docs checked (2026-10-24):**
- Workers static assets: https://developers.cloudflare.com/workers/static-assets/binding/ (`assets.directory`, `binding`, `run_worker_first` array with `!` negation, `env.ASSETS.fetch`), https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/ (default `auto-trailing-slash`: `/menu` serves `menu.html`), https://developers.cloudflare.com/workers/wrangler/configuration/ (`not_found_handling`: `"single-page-application" | "404-page" | "none"`; `migrations` is legacy but accepted, mutually exclusive with DO entries in `exports`).
- Durable Objects WebSocket Hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/ (`this.ctx.acceptWebSocket(server)`, `webSocketMessage(ws, message: ArrayBuffer | string)`, `webSocketClose(ws, code, reason, wasClean)`, `this.ctx.getWebSockets()`, `serializeAttachment` ≤ 16,384 bytes / `deserializeAttachment()`; compat date ≥ 2026-04-07 auto-replies to Close frames; **a deploy restarts every DO and disconnects all WebSockets**).
- SQLite DOs: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/ (`"migrations": [{ "tag": "v1", "new_sqlite_classes": ["…"] }]`; the Free plan only offers SQLite-backed DOs), https://developers.cloudflare.com/durable-objects/get-started/ (`import { DurableObject } from "cloudflare:workers"`).
- TURN: https://developers.cloudflare.com/realtime/turn/generate-credentials/ (`POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers`, `Authorization: Bearer $TURN_KEY_API_TOKEN`, body `{"ttl": N}`, 201 with `{ iceServers: [...] }`; port-53 URLs time out in browsers — filter them).
- Next static export: https://nextjs.org/docs/app/guides/static-exports (`output: 'export'` → `out/`, `out/404.html`; unsupported: route handlers reading Request, cookies, rewrites, redirects, headers, proxy, ISR, default image loader, server actions — none used here; `next/font/google` is not on the list and is self-hosted at build time).
- Workers vitest: https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/ — the package is now `@cloudflare/vitest-plugin` (1.4.7, peer `vitest ^4.1.0 || ^5.0.0`; the older `@cloudflare/vitest-pool-workers@0.23.0` also peers `vitest ^4.1.0`). Both are compatible with this repo's vitest 4.1.10. **Chosen instead:** framework-free pure modules (`worker/src/room.ts`, `ice.ts`, `routes.ts`) tested in plain vitest, plus a `wrangler dev` integration test and a two-browser Playwright run. Reason: one test runner, no second pool config, and the DO shell is ~80 lines with no logic of its own; the integration test exercises the real workerd.

---

## Global Constraints

- Determinism: `src/engine/**` keeps Q12 fixed point, `Ratio` constants and the LUT trig.
- Determinism: the engine must not use `Math.random`, `Date`, `performance.now` or float trig; `src/engine/layering.test.ts` must keep passing and keep its forbidden list.
- Determinism: anything the sim reads from animation is baked at build time into integer tables; the sim never evaluates float animation at runtime.
- Tests: Vitest unit/property tests and Playwright e2e (Chromium desktop) stay green after every task.
- Tests: new behaviour is TDD.
- Tests: commands are `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and e2e as `pnpm test:e2e` (this repo's script name for the spec's `pnpm e2e`).
- Repo: `DavidBrin/Replicates` is a public GitHub repo and is committed straight to `main`.
- Repo: Nintendo-ripped model and texture files are never committed (nothing in this plan adds any).
- Directory: stays `Replicates/super-smash/`; only user-visible names change (wiki slug `Super_Smash_(replica)` and David-Internet slug `super-smash` stay).
- Hosting: Cloudflare free plan only, on David's existing account (Davidb.sites@gmail.com, the one hosting `leaders.leaders-game.workers.dev`); never enable paid features; a step needing a card or a paid plan stops and asks David.
- Gameplay data: published sources only; a number that cannot be sourced is tuned and marked `UNVERIFIED:`.
- Netcode: stays P2P rollback (`src/net/rollback.ts`); never a server-side sim tick (no `setInterval` in a Durable Object).
- Outward actions (deploying, taking down Vercel, editing the live David-Internet or wiki deploys) need David's go at the step; `wrangler login` is run by David with `!`.

## Review Focus

The five user-facing failure modes no feature test would otherwise catch, and where each one's test lives:

1. **A third player joins a full room** (two friends already linked, a third types the same code). Must be turned away with "Room ABCD already has two players." and must not disturb the two. Tests: `worker/src/room.test.ts` "turns a third peer away" (Task 5), `src/net/roomWorker.integration.test.ts` against `wrangler dev` (Task 7), `src/components/online/OnlineLobby.test.tsx` "tells a third player the room is full" (Task 19).
2. **Room code typed lowercase, with a dash, or with an O/0/I/1** (codes are read aloud). Lowercase/dash must join the same room; O/0/I/1 must be explained and must never silently join a different room. Tests: `src/net/roomCode.test.ts` (Task 3), `OnlineLobby.test.tsx` "joins a code typed in lowercase" and "explains a code with an O instead of joining another room" (Task 19), the two-browser e2e types the code in lowercase (Task 22).
3. **The other peer's tab is backgrounded mid-match** (rAF stops, its packets stop). Must show "Opponent switched tabs…" and wait up to 60 s, not end the match at the 10 s silence limit. Tests: `src/net/online/watchdog.test.ts` (Task 11), `src/game/linkMonitor.test.ts` "a backgrounded opponent gets a minute, not ten seconds" (Task 21).
4. **TURN secrets missing, half-set, or Cloudflare's TURN API failing/hanging.** `/api/ice` must answer STUN-only and the lobby must never hang on it. Tests: `worker/src/ice.test.ts` (Task 6), `src/net/iceServers.test.ts` "gives up after the timeout" (Task 8).
5. **A deploy restarts the Durable Object mid-match** (both signalling sockets drop with 1006; Cloudflare documents this). The P2P DataChannel is unaffected, so the match must continue and must not be reported as "Connection lost". Tests: `src/net/adapters/doSignal.test.ts` "keeps playing when the room's sockets drop mid-match" (Task 10), `src/net/online/session.test.ts` "a room restart after joining is not an error" (Task 13).

---

## File Structure

Created:
- `src/lib/brand.ts` — `PRODUCT_NAME`, `PRODUCT_SLUG`, `pageTitle()`; the one place the product name lives.
- `src/lib/brand.test.ts` — every screen title, the network slug, and a scan for leftover "Super Smash".
- `src/app/staticExport.test.ts` — `output: "export"` and no route handlers.
- `src/net/roomCode.ts` (+ `.test.ts`) — room-code alphabet, `makeRoomCode`, `normalizeRoomCode`, `roomCodeProblem` (moved out of the Trystero adapter so the Worker can use it).
- `src/net/channel.ts` — the shared negotiated input-channel label/id (42).
- `src/net/signalProtocol.ts` (+ `.test.ts`) — JSON message types and parsers shared by the Worker and the browser.
- `src/net/iceConfig.ts` (+ `.test.ts`) — ICE server wire shape, `STUN_ONLY`, port-53 filter (shared).
- `src/net/iceServers.ts` (+ `.test.ts`) — browser fetch of `/api/ice` with timeout and STUN fallback.
- `src/net/signalling.ts` (+ `.test.ts`) — WebSocket client for `/ws/room/:code`.
- `src/net/adapters/doSignal.ts` (+ `.test.ts`) — the Durable-Object-signalled WebRTC `Transport`.
- `src/net/online/watchdog.ts` (+ `.test.ts`) — silence/away → ok/waiting/lost.
- `src/net/online/lobby.ts` (+ `.test.ts`) — lobby messages (`pick`, `stage`, `start`, `away`) and `OnlineMatchConfig`.
- `src/net/online/session.ts` (+ `.test.ts`) — `OnlineSession` (signalling + transport + lobby) and the active-session singleton.
- `src/game/onlineConfig.ts` (+ `.test.ts`) — host-side `buildStartConfig`, `newMatchSeed`, `runnerSlotsFor`.
- `src/game/rollbackDeps.ts` (+ `.test.ts`) — the engine in `RollbackDeps` shape.
- `src/game/linkMonitor.ts` (+ `.test.ts`) — watchdog + transport + visibility wiring for an online match.
- `src/lib/onlineStore.ts` (+ `.test.ts`) — zustand store for the online UI, `bindSession`, `sendLobby`, `leaveOnline`.
- `src/components/online/OnlineLobby.tsx` (+ `.test.tsx`) — Create/Join room screen.
- `src/components/menu/CharacterSelect.online.test.tsx` — online behaviour of the existing select screen.
- `src/components/match/NetHud.tsx` (+ `.test.tsx`) — ping / delay / rollbacks overlay.
- `src/app/online/page.tsx` — `/online` route.
- `worker/src/room.ts` (+ `.test.ts`) — pure room rules: admit/reject, relay, departures.
- `worker/src/ice.ts` (+ `.test.ts`) — TURN credential minting with STUN fallback.
- `worker/src/routes.ts` (+ `.test.ts`) — URL → route.
- `worker/src/env.ts` — the Worker's `Env` bindings type.
- `worker/src/roomDO.ts` — `RoomDO` Durable Object shell (hibernation API).
- `worker/src/index.ts` — Worker entry.
- `src/net/roomWorker.integration.test.ts` — runs against `wrangler dev` / the live Worker when `WORKER_URL` is set (under `src/` so the app's tsconfig, with DOM `WebSocket` and Node `process`, checks it).
- `worker/tsconfig.json` — Workers-typed compile of `worker/` + the shared `src/net` files.
- `wrangler.jsonc` — Worker `david-smash`, assets `./out`, `RoomDO` binding + SQLite migration.
- `playwright.online.config.ts`, `e2e-online/online.spec.ts` — two-browser online match (local `wrangler dev` or the public URL).

Modified:
- `next.config.ts` — `output: "export"`.
- `package.json` — name, wrangler devDeps, scripts (`typecheck`, `preview`, `deploy`, `test:e2e:online`; `start` removed).
- `pnpm-workspace.yaml` — allow `esbuild`/`workerd` build scripts.
- `tsconfig.json` — exclude `worker` and `.wrangler`.
- `eslint.config.mjs` — ignore `.wrangler/**`.
- `vitest.config.mts` — include `worker/**/*.test.ts`.
- `.gitignore` — `.wrangler/`, `.dev.vars*`.
- `playwright.config.ts` — `pnpm exec next dev` web server (Task 2); `SMASH_URL` runs the suite against the public site (Task 22).
- `src/app/layout.tsx`, `src/app/{menu,results,fighters,rules,stage,controls}/page.tsx`, `src/app/not-found.tsx` — titles.
- `src/app/play/page.tsx` — online path, gamepad, NetHud, connection-lost handling.
- `src/components/menu/{MainMenu,TitleScreen,CharacterSelect,StageSelect,Results}.tsx` (+ tests) — name, live Online tile, online mode, "Connection lost".
- `src/engine/types.ts`, `src/engine/states.ts`, `src/engine/knockback.ts`, `src/engine/simulate.ts`, `src/engine/constants.ts` (+ tests) — `Btn.Soft`: walk, tilt, partial DI.
- `src/input/gamepad.ts` (+ test) — `Btn.Soft`, `mergeKeyboardAndPad`, `padPortMap`.
- `src/game/matchRunner.ts` (+ test) — gamepad input, `RollbackSession` for online, `netStats`, `dispose`.
- `src/lib/matchConfig.ts` — `MatchResult` "connectionLost"/`online`, `configureOnline`, `leaveOnline`.
- `src/net/adapters/webrtc.ts`, `src/net/adapters/broadcast.ts` (+ test) — re-exports, new app id.
- `src/net/packet.ts` (+ test) — comment + Soft bit round-trip.
- `e2e/flow.spec.ts` — Online tile is live; `<title>` is David-Smash.
- `README.md`, `.env.example`, `DECISIONS.md` (D54).
- Remediation: `David-Internet/content/super-smash/site.ts`, `README.md`, `e2e/images.spec.ts`, `e2e/feeling-lucky.spec.ts`, `content/path/journey.ts`; `Replicates/Wikipedia/src/content/projects.ts`, `src/content/articles/{meta.ts,super-smash.tsx,dollar-pixels.tsx,fl-studio.tsx,island-empire.tsx,fake-phone.tsx,leaders.tsx,davids-internet.tsx}`, `src/content/__tests__/{projects.test.ts,sections.test.tsx}`, `e2e/support.ts`.

Spec §3.3 coverage: Name → Task 1 (+25, 26); Build → Tasks 2, 7; Signalling → Tasks 4, 5, 7; TURN → Tasks 6, 8, 24; Transport → Tasks 3, 9, 10, 13; Online UI → Tasks 12, 14, 17, 18, 19, 20, 21; Gamepad → Tasks 15, 16, 17, 21; Remediation 1 → Tasks 22, 24; Remediation 2 → Tasks 25, 26; Remediation 3 → Task 27; README/.env.example → Task 23.

---
### Task 1: Rename everything a player reads to David-Smash

**Files:**
- Create: `super-smash/src/lib/brand.ts`, `super-smash/src/lib/brand.test.ts`
- Modify: `super-smash/src/app/layout.tsx:32-36`; `super-smash/src/app/menu/page.tsx:5`, `results/page.tsx:5`, `fighters/page.tsx:5`, `rules/page.tsx:5`, `stage/page.tsx:5`, `controls/page.tsx:5`; `super-smash/src/app/not-found.tsx:6`; `super-smash/src/components/menu/MainMenu.tsx:116`; `super-smash/src/components/menu/TitleScreen.tsx:72,129`; `super-smash/src/net/adapters/webrtc.ts:128`; `super-smash/src/net/adapters/broadcast.ts:20`; `super-smash/src/net/adapters/broadcast.test.ts:221`; `super-smash/package.json:2`; `super-smash/src/components/menu/MainMenu.test.tsx`; `super-smash/src/components/menu/TitleScreen.test.tsx`

**Interfaces:**
- Produces: `export const PRODUCT_NAME = "David-Smash"`, `export const PRODUCT_SLUG = "david-smash"`, `export function pageTitle(screen: string): string`
- Produces (changed value): `DEFAULT_APP_ID === "david-smash"` in `src/net/adapters/webrtc.ts`

- [ ] **Step 1: Write the failing test** — create `src/lib/brand.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { metadata as controls } from "@/app/controls/page";
import { metadata as fighters } from "@/app/fighters/page";
import { metadata as menu } from "@/app/menu/page";
import { metadata as notFound } from "@/app/not-found";
import { metadata as results } from "@/app/results/page";
import { metadata as rules } from "@/app/rules/page";
import { metadata as stage } from "@/app/stage/page";
import { DEFAULT_APP_ID } from "@/net/adapters/webrtc";
import { PRODUCT_NAME, PRODUCT_SLUG, pageTitle } from "./brand";

// From the working directory, for the reason layering.test.ts gives: vitest
// serves files over http: under jsdom and `fileURLToPath` refuses it.
const SRC = join(process.cwd(), "src");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the product name", () => {
  it("is David-Smash, and its network slug matches", () => {
    expect(PRODUCT_NAME).toBe("David-Smash");
    expect(PRODUCT_SLUG).toBe("david-smash");
  });

  it("titles every screen", () => {
    const screens: [string, { title?: unknown }][] = [
      ["Main Menu", menu],
      ["Results", results],
      ["Character Select", fighters],
      ["Rules", rules],
      ["Stage Select", stage],
      ["Controls", controls],
      ["No Contest", notFound],
    ];
    for (const [screen, meta] of screens) expect(meta.title).toBe(pageTitle(screen));
  });

  it("namespaces Trystero rooms under the new name", () => {
    expect(DEFAULT_APP_ID).toBe(PRODUCT_SLUG);
  });

  it("leaves the old name nowhere a player can read it", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of sources(join(SRC, dir))) {
        // "Super Smash Bros." is the game being replicated, and stays.
        if (/Super Smash(?! Bros)/.test(readFileSync(file, "utf8"))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

Append to `src/components/menu/MainMenu.test.tsx` inside `describe("MainMenu", …)`:

```tsx
  it("carries the product name in the header", async () => {
    await renderMenu();
    expect(screen.getByText("David-Smash")).toBeInTheDocument();
  });
```

Append to `src/components/menu/TitleScreen.test.tsx` inside `describe("TitleScreen", …)`:

```tsx
  it("spells the wordmark and the emblem as David-Smash", () => {
    render(<TitleScreen />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/david\s*smash/i);
    expect(screen.getAllByRole("img", { name: "David-Smash emblem" }).length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/lib/brand.test.ts src/components/menu/MainMenu.test.tsx src/components/menu/TitleScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./brand" from "src/lib/brand.test.ts"`, and the two component tests fail with `Unable to find an element with the text: David-Smash` / heading text `SuperSmash`.

- [ ] **Step 3: Implement** — create `src/lib/brand.ts`:

```ts
/**
 * The product's name, in one place.
 *
 * The directory, the wiki slug and the David-Internet slug all keep the old
 * `super-smash` spelling on purpose (spec §3.1): renaming them would break the
 * docs mirror and every inbound link. Only what a player reads changes, and a
 * constant is how "only what a player reads" stays a short, testable list.
 */
export const PRODUCT_NAME = "David-Smash";

/** The network namespace: Trystero's appId and the BroadcastChannel prefix. */
export const PRODUCT_SLUG = "david-smash";

/** `"Main Menu · David-Smash"` — every route's `<title>`. */
export function pageTitle(screen: string): string {
  return `${screen} · ${PRODUCT_NAME}`;
}
```

Edit each page file — e.g. `src/app/menu/page.tsx` becomes:

```tsx
import type { Metadata } from "next";

import { MainMenu } from "@/components/menu/MainMenu";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Main Menu") };

export default function Page() {
  return <MainMenu />;
}
```

Apply the same two-line change (`import { pageTitle } from "@/lib/brand";` and `{ title: pageTitle("<Screen>") }`) to: `results/page.tsx` ("Results"), `fighters/page.tsx` ("Character Select"), `rules/page.tsx` ("Rules"), `stage/page.tsx` ("Stage Select"), `controls/page.tsx` ("Controls"), `not-found.tsx` ("No Contest").

`src/app/layout.tsx`: add `import { PRODUCT_NAME } from "@/lib/brand";` after the `next/font/google` import and replace line 33 `title: "Super Smash",` with `title: PRODUCT_NAME,`.

`src/components/menu/MainMenu.tsx`: add `import { PRODUCT_NAME } from "@/lib/brand";` after the `useRoster` import, and replace line 116 `          Super Smash` with `          {PRODUCT_NAME}`.

`src/components/menu/TitleScreen.tsx`: add `import { PRODUCT_NAME } from "@/lib/brand";` to the imports; replace the first wordmark span's text `            Super` (line 72) with `            David`; replace line 129 `aria-label={decorative ? undefined : "Super Smash emblem"}` with `aria-label={decorative ? undefined : \`${PRODUCT_NAME} emblem\`}`.

`src/net/adapters/webrtc.ts`: add `import { PRODUCT_SLUG } from "@/lib/brand";` after the trystero import; replace line 128 `export const DEFAULT_APP_ID = "super-smash";` with `export const DEFAULT_APP_ID = PRODUCT_SLUG;`.

`src/net/adapters/broadcast.ts`: add `import { PRODUCT_SLUG } from "@/lib/brand";` above the transport import; replace line 20 `const CHANNEL_PREFIX = "super-smash:";` with ``const CHANNEL_PREFIX = `${PRODUCT_SLUG}:`;``.

`src/net/adapters/broadcast.test.ts:221`: `bus.open("super-smash:room")` → `bus.open("david-smash:room")`.

`package.json:2`: `"name": "super-smash",` → `"name": "david-smash",`.

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/lib/brand.test.ts src/components/menu src/net/adapters/broadcast.test.ts src/net/adapters/webrtc.test.ts`
Expected: PASS (all files).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit** (from the Replicates root)

```bash
git add super-smash/src/lib/brand.ts super-smash/src/lib/brand.test.ts super-smash/src/app/layout.tsx super-smash/src/app/menu/page.tsx super-smash/src/app/results/page.tsx super-smash/src/app/fighters/page.tsx super-smash/src/app/rules/page.tsx super-smash/src/app/stage/page.tsx super-smash/src/app/controls/page.tsx super-smash/src/app/not-found.tsx super-smash/src/components/menu/MainMenu.tsx super-smash/src/components/menu/MainMenu.test.tsx super-smash/src/components/menu/TitleScreen.tsx super-smash/src/components/menu/TitleScreen.test.tsx super-smash/src/net/adapters/webrtc.ts super-smash/src/net/adapters/broadcast.ts super-smash/src/net/adapters/broadcast.test.ts super-smash/package.json
git commit -m "super-smash: call the product David-Smash everywhere a player reads it" -m "One constant (src/lib/brand.ts) names the product; every route title, the menu header, the title wordmark, the emblem label and the network app id read from it. The directory and the wiki/David-Internet slugs keep super-smash (spec 3.1)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Build a static export into `out/`

**Files:**
- Create: `super-smash/src/app/staticExport.test.ts`
- Modify: `super-smash/next.config.ts:4-11`, `super-smash/playwright.config.ts:61` (web server command — under pnpm 11 `pnpm run dev -- --port N` hands `--` to Next, which fails with "Invalid project directory …/--port")

**Interfaces:**
- Produces: `nextConfig.output === "export"`; `pnpm build` writes `out/index.html`, `out/menu.html`, …, `out/404.html` (consumed by `wrangler.jsonc` in Task 7).

- [ ] **Step 1: Write the failing test** — `src/app/staticExport.test.ts`:

```ts
// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

const APP = join(process.cwd(), "src", "app");

function routeHandlers(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeHandlers(full));
    else if (/^route\.(ts|tsx|js)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the static export", () => {
  it("builds into out/ rather than needing a Node server", () => {
    expect(nextConfig.output).toBe("export");
  });

  it("keeps every route static: no route handlers anywhere under app/", () => {
    expect(routeHandlers(APP)).toEqual([]);
  });

  it("emits /menu as out/menu.html, which is what Workers' auto-trailing-slash serves", () => {
    expect(nextConfig.trailingSlash ?? false).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/app/staticExport.test.ts`
Expected: FAIL — `expected undefined to be 'export'`. (The route-handler and trailing-slash tests already pass: they are regression checks that pin today's behaviour.)

- [ ] **Step 3: Implement** — in `next.config.ts` replace the doc comment and add `output`:

```ts
/**
 * A static export, served by the `david-smash` Cloudflare Worker's static
 * assets (wrangler.jsonc). Every route already prerenders — there is no route
 * handler, cookie, header, rewrite or image loader to lose (spec §3.3) — so
 * the whole game is files, and the Worker only runs for /api/* and /ws/*.
 */
const nextConfig: NextConfig = {
  output: "export",

  reactStrictMode: true,
```

(Leave the rest of the object — `devIndicators`, `agentRules`, `turbopack` — unchanged.)

- [ ] **Step 4: Run the test, then the build**

Run: `pnpm vitest run src/app/staticExport.test.ts`
Expected: PASS (3 tests).

Run: `pnpm build && ls out | grep -E '^(index|menu|rules|stage|fighters|play|results|controls|anim|404)\.html$' | wc -l`
Expected: build succeeds; the count prints `10`.

- [ ] **Step 5: Make the e2e web server start under pnpm 11** — in `playwright.config.ts` replace

```ts
    command: `pnpm run dev -- --port ${PORT}`,
```

with

```ts
    // `pnpm run dev -- --port` passes the `--` through to Next under pnpm 11,
    // which then reads "--port" as the project directory.
    command: `pnpm exec next dev --port ${PORT}`,
```

- [ ] **Step 6: Full gate + local e2e still green against `next dev`**

Run: `pnpm typecheck && pnpm lint && pnpm test && PORT=3107 pnpm test:e2e`
Expected: exit 0 (the e2e suite still uses `next dev`, which ignores `output`).

- [ ] **Step 7: Commit**

```bash
git add super-smash/next.config.ts super-smash/src/app/staticExport.test.ts super-smash/playwright.config.ts
git commit -m "super-smash: build a static export into out/" -m "output: export. Every route was already static; the Worker in a later commit serves out/ as static assets." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Move room codes and the input-channel constants out of the Trystero adapter

**Files:**
- Create: `super-smash/src/net/roomCode.ts`, `super-smash/src/net/roomCode.test.ts`, `super-smash/src/net/channel.ts`
- Modify: `super-smash/src/net/adapters/webrtc.ts:41-80` (imports + room-code section), `:129-131` (channel constants), `:309-317` (`defaultRandom`)

**Interfaces:**
- Produces: `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH`, `makeRoomCode(random?: () => number): string`, `normalizeRoomCode(input: string): string | null`, `roomCodeProblem(input: string): string | null` from `src/net/roomCode.ts`.
- Produces: `INPUT_CHANNEL_LABEL = "smash-input"`, `DEFAULT_UNRELIABLE_CHANNEL_ID = 42` from `src/net/channel.ts`.
- `src/net/adapters/webrtc.ts` keeps exporting all of the above by re-export, so `webrtc.test.ts` is untouched.

- [ ] **Step 1: Write the failing test** — `src/net/roomCode.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import * as viaAdapter from "./adapters/webrtc";
import { DEFAULT_UNRELIABLE_CHANNEL_ID, INPUT_CHANNEL_LABEL } from "./channel";
import { ROOM_CODE_ALPHABET, makeRoomCode, normalizeRoomCode, roomCodeProblem } from "./roomCode";

describe("room codes, from their own module", () => {
  it("are the very functions the Trystero adapter has always exported", () => {
    expect(viaAdapter.normalizeRoomCode).toBe(normalizeRoomCode);
    expect(viaAdapter.makeRoomCode).toBe(makeRoomCode);
    expect(viaAdapter.ROOM_CODE_ALPHABET).toBe(ROOM_CODE_ALPHABET);
    expect(viaAdapter.DEFAULT_UNRELIABLE_CHANNEL_ID).toBe(DEFAULT_UNRELIABLE_CHANNEL_ID);
    expect(viaAdapter.INPUT_CHANNEL_LABEL).toBe(INPUT_CHANNEL_LABEL);
  });

  it("keeps the negotiated input channel on stream 42", () => {
    expect(DEFAULT_UNRELIABLE_CHANNEL_ID).toBe(42);
  });

  it("joins the same room for a code typed in lowercase, spaced or dashed", () => {
    expect(normalizeRoomCode("abcd")).toBe("ABCD");
    expect(normalizeRoomCode(" ab cd ")).toBe("ABCD");
    expect(normalizeRoomCode("ab-cd")).toBe("ABCD");
    expect(roomCodeProblem("ab-cd")).toBeNull();
  });

  it("explains an O, I, 0 or 1 instead of joining a different room", () => {
    for (const typed of ["ABOD", "abod", "AB0D", "ABID", "AB1D"]) {
      expect(normalizeRoomCode(typed)).toBeNull();
      expect(roomCodeProblem(typed)).toMatch(/never use I, O, 1 or 0/);
    }
  });

  it("explains a code of the wrong length, or with punctuation", () => {
    expect(roomCodeProblem("ABC")).toMatch(/4 letters/);
    expect(roomCodeProblem("ABCDE")).toMatch(/4 letters/);
    expect(roomCodeProblem("AB!D")).toMatch(/letters only/);
  });

  it("only ever makes codes it would accept", () => {
    for (let i = 0; i < 200; i++) expect(roomCodeProblem(makeRoomCode())).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/net/roomCode.test.ts`
Expected: FAIL — `Failed to resolve import "./channel" from "src/net/roomCode.test.ts"`.

- [ ] **Step 3: Implement** — `src/net/roomCode.ts`:

```ts
/**
 * Four uppercase letters, minus `I` and `O`.
 *
 * One player reads this aloud to the other, which is the whole design brief:
 * short enough to say in one breath, and free of the pairs that get misheard.
 * `I`/`1` and `O`/`0` are the classic offenders, and dropping them costs
 * nothing — 24^4 is 331,776 rooms.
 *
 * Lives on its own (it used to sit in the Trystero adapter) because the
 * Cloudflare Worker validates codes too, and the Worker must not import
 * Trystero.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

export function makeRoomCode(random: () => number = defaultRandom): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Accept what a human typed, or reject it.
 *
 * Lowercase, stray spaces and a dash are typos, not different rooms, so they
 * are repaired. `I`, `O`, `1` and `0` are not in the alphabet, so a code
 * containing one was misheard — and silently joining a *different* valid room
 * would be worse than telling them to look again.
 */
export function normalizeRoomCode(input: string): string | null {
  const cleaned = clean(input);
  if (cleaned.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

/** Why a typed code is not a code, in words for the lobby — or null if it is one. */
export function roomCodeProblem(input: string): string | null {
  const cleaned = clean(input);
  if (cleaned.length !== ROOM_CODE_LENGTH) return `A room code is ${ROOM_CODE_LENGTH} letters.`;
  if (/[IO10]/.test(cleaned)) return "Room codes never use I, O, 1 or 0. Check that letter with the host.";
  if (normalizeRoomCode(cleaned) === null) return "A room code is letters only.";
  return null;
}

function clean(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

function defaultRandom(): number {
  // Not `globalThis.crypto`: the Worker compiles this file under workers-types,
  // where that property does not exist; the bare global does in both programs.
  const cryptoObj: Crypto | undefined = typeof crypto === "undefined" ? undefined : crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    cryptoObj.getRandomValues(buffer);
    return buffer[0] / 0x1_0000_0000;
  }
  return Math.random();
}
```

`src/net/channel.ts`:

```ts
/**
 * The unreliable input channel both WebRTC adapters open.
 *
 * Shared so the Trystero adapter and the Durable Object adapter agree on the
 * one thing two peers must agree on out of band: the SCTP stream id of a
 * `negotiated: true` channel. Neither side announces it; both use 42, and the
 * channel is `{ ordered: false, maxRetransmits: 0 }` — see the header of
 * adapters/webrtc.ts for why inputs must not be retransmitted.
 */
export const INPUT_CHANNEL_LABEL = "smash-input";
/** Any id both peers agree on and Trystero does not use (it takes 0). */
export const DEFAULT_UNRELIABLE_CHANNEL_ID = 42;
```

`src/net/adapters/webrtc.ts`:
1. Replace the import lines (after Task 1 they read)
```ts
import { joinRoom, selfId as trysteroSelfId } from "trystero";
import { PRODUCT_SLUG } from "@/lib/brand";
import { createEmitter, type Transport } from "../transport";
```
with
```ts
import { joinRoom, selfId as trysteroSelfId } from "trystero";
import { PRODUCT_SLUG } from "@/lib/brand";
import { DEFAULT_UNRELIABLE_CHANNEL_ID, INPUT_CHANNEL_LABEL } from "../channel";
import { normalizeRoomCode } from "../roomCode";
import { createEmitter, type Transport } from "../transport";

export { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, makeRoomCode, normalizeRoomCode } from "../roomCode";
export { DEFAULT_UNRELIABLE_CHANNEL_ID, INPUT_CHANNEL_LABEL } from "../channel";
```
2. Delete the whole `/* -------------------------------------------------------------- room codes -- */` section (the doc comments and the `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH`, `makeRoomCode`, `normalizeRoomCode` definitions, original lines 44–80).
3. Delete the three lines `export const INPUT_CHANNEL_LABEL = "smash-input";`, `/** Any id both peers agree on and Trystero does not use. */`, `export const DEFAULT_UNRELIABLE_CHANNEL_ID = 42;`.
4. Delete the trailing `function defaultRandom(): number { … }` (original lines 309–317).

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/net/roomCode.test.ts src/net/adapters/webrtc.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/net/roomCode.ts super-smash/src/net/roomCode.test.ts super-smash/src/net/channel.ts super-smash/src/net/adapters/webrtc.ts
git commit -m "super-smash: room codes and the input channel id get their own modules" -m "The Worker validates room codes and must not import Trystero. roomCodeProblem() explains an O/I/0/1 instead of joining a different room. webrtc.ts re-exports everything it used to define." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The signalling protocol and ICE config shared by Worker and browser

**Files:**
- Create: `super-smash/src/net/signalProtocol.ts`, `super-smash/src/net/signalProtocol.test.ts`, `super-smash/src/net/iceConfig.ts`, `super-smash/src/net/iceConfig.test.ts`

**Interfaces (Produces):**
```ts
// signalProtocol.ts
export type Role = "host" | "guest";
export const ROLE_PORT: Readonly<Record<Role, number>>;            // { host: 0, guest: 1 }
export type RoomIntent = "create" | "join";
export type RoomError = "full" | "taken" | "not-found" | "bad-message" | "too-many-messages";
export const ROOM_CLOSE_CODES: Readonly<Record<RoomError, number>>; // 4001,4002,4003,4004,4008
export const MAX_MESSAGE_BYTES: number;                             // 16384
export const MAX_MESSAGES_PER_PEER: number;                         // 2000
export interface PeerInfo { readonly id: string; readonly role: Role }
export interface WireIceCandidate { readonly candidate: string; readonly sdpMid: string | null; readonly sdpMLineIndex: number | null; readonly usernameFragment: string | null }
export type SignalPayload = { kind: "offer"; sdp: string } | { kind: "answer"; sdp: string } | { kind: "ice"; candidate: WireIceCandidate };
export interface OpaquePayload { readonly kind: string; readonly [key: string]: unknown }
export type ClientMessage = { t: "signal"; payload: SignalPayload } | { t: "lobby"; payload: OpaquePayload };
export type ServerMessage =
  | { t: "welcome"; self: PeerInfo; peer: PeerInfo | null } | { t: "peer-joined"; peer: PeerInfo } | { t: "peer-left"; peerId: string }
  | { t: "signal"; from: string; payload: SignalPayload } | { t: "lobby"; from: string; payload: OpaquePayload } | { t: "error"; reason: RoomError };
export function parseRoomIntent(value: string | null): RoomIntent | null;
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null; // raw frame text
export function parseSignalPayload(value: unknown): SignalPayload | null;
export function parseServerMessage(value: unknown): ServerMessage | null;            // already JSON.parse'd
export function roomErrorForCloseCode(code: number): RoomError | null;
// iceConfig.ts
export interface IceServerWire { readonly urls: string | readonly string[]; readonly username?: string; readonly credential?: string }
export interface IceResponse { readonly iceServers: readonly IceServerWire[]; readonly turn: boolean }
export const STUN_URL: "stun:stun.cloudflare.com:3478";
export const STUN_ONLY: IceResponse;
export function urlsOf(server: IceServerWire): readonly string[];
export function withoutPort53(servers: readonly IceServerWire[]): IceServerWire[];
export function hasTurn(servers: readonly IceServerWire[]): boolean;
export function parseIceServers(value: unknown): IceServerWire[] | null;
export function parseIceResponse(value: unknown): IceResponse | null;
```

- [ ] **Step 1: Write the failing tests** — `src/net/signalProtocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_BYTES,
  ROLE_PORT,
  ROOM_CLOSE_CODES,
  parseClientMessage,
  parseRoomIntent,
  parseServerMessage,
  roomErrorForCloseCode,
  type RoomError,
} from "./signalProtocol";

const CANDIDATE = "candidate:1 1 udp 2122260223 192.168.1.4 54321 typ host";

describe("client messages, as the room reads them", () => {
  it("accepts an offer, an answer and an ICE candidate", () => {
    expect(parseClientMessage(JSON.stringify({ t: "signal", payload: { kind: "offer", sdp: "v=0" } }))).toEqual({
      t: "signal",
      payload: { kind: "offer", sdp: "v=0" },
    });
    expect(parseClientMessage(JSON.stringify({ t: "signal", payload: { kind: "answer", sdp: "v=1" } }))).toEqual({
      t: "signal",
      payload: { kind: "answer", sdp: "v=1" },
    });
    expect(
      parseClientMessage(
        JSON.stringify({ t: "signal", payload: { kind: "ice", candidate: { candidate: CANDIDATE, sdpMid: "0", sdpMLineIndex: 0 } } }),
      ),
    ).toEqual({
      t: "signal",
      payload: { kind: "ice", candidate: { candidate: CANDIDATE, sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null } },
    });
  });

  it("passes lobby payloads through without understanding them", () => {
    const payload = { kind: "pick", fighterId: "fox", costume: 1 };
    expect(parseClientMessage(JSON.stringify({ t: "lobby", payload }))).toEqual({ t: "lobby", payload });
  });

  it("rejects binary frames, oversized frames, bad JSON and anything it does not know", () => {
    expect(parseClientMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseClientMessage("x".repeat(MAX_MESSAGE_BYTES + 1))).toBeNull();
    expect(parseClientMessage("{nope")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "welcome" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "signal", payload: { kind: "offer" } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "signal", payload: { kind: "ice", candidate: {} } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "lobby", payload: "pick" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "lobby", payload: { kind: "k".repeat(33) } }))).toBeNull();
  });
});

describe("server messages, as the browser reads them", () => {
  it("reads a welcome with and without somebody already in the room", () => {
    expect(parseServerMessage({ t: "welcome", self: { id: "a", role: "host" }, peer: null })).toEqual({
      t: "welcome",
      self: { id: "a", role: "host" },
      peer: null,
    });
    expect(
      parseServerMessage({ t: "welcome", self: { id: "b", role: "guest" }, peer: { id: "a", role: "host" } }),
    ).toEqual({ t: "welcome", self: { id: "b", role: "guest" }, peer: { id: "a", role: "host" } });
  });

  it("reads joins, leaves, relayed signals, lobby payloads and errors", () => {
    expect(parseServerMessage({ t: "peer-joined", peer: { id: "b", role: "guest" } })).toEqual({
      t: "peer-joined",
      peer: { id: "b", role: "guest" },
    });
    expect(parseServerMessage({ t: "peer-left", peerId: "b" })).toEqual({ t: "peer-left", peerId: "b" });
    expect(parseServerMessage({ t: "signal", from: "a", payload: { kind: "offer", sdp: "v=0" } })).toEqual({
      t: "signal",
      from: "a",
      payload: { kind: "offer", sdp: "v=0" },
    });
    expect(parseServerMessage({ t: "lobby", from: "a", payload: { kind: "away", away: true } })).toEqual({
      t: "lobby",
      from: "a",
      payload: { kind: "away", away: true },
    });
    expect(parseServerMessage({ t: "error", reason: "full" })).toEqual({ t: "error", reason: "full" });
  });

  it("rejects a malformed role, a missing sender or an unknown error", () => {
    expect(parseServerMessage({ t: "welcome", self: { id: "a", role: "boss" }, peer: null })).toBeNull();
    expect(parseServerMessage({ t: "signal", payload: { kind: "offer", sdp: "v=0" } })).toBeNull();
    expect(parseServerMessage({ t: "error", reason: "on-fire" })).toBeNull();
    expect(parseServerMessage("welcome")).toBeNull();
  });
});

describe("room vocabulary", () => {
  it("puts the host on port 0 and the guest on port 1", () => {
    expect(ROLE_PORT).toEqual({ host: 0, guest: 1 });
  });

  it("maps every close code back to its reason, and nothing else", () => {
    for (const [reason, code] of Object.entries(ROOM_CLOSE_CODES)) {
      expect(roomErrorForCloseCode(code)).toBe(reason as RoomError);
    }
    expect(roomErrorForCloseCode(1006)).toBeNull();
    expect(roomErrorForCloseCode(1000)).toBeNull();
  });

  it("reads only the two intents", () => {
    expect(parseRoomIntent("create")).toBe("create");
    expect(parseRoomIntent("join")).toBe("join");
    expect(parseRoomIntent("spectate")).toBeNull();
    expect(parseRoomIntent(null)).toBeNull();
  });
});
```

`src/net/iceConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { STUN_ONLY, STUN_URL, hasTurn, parseIceResponse, withoutPort53 } from "./iceConfig";

const CLOUDFLARE_SHAPE = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
  {
    urls: [
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turn:turn.cloudflare.com:53?transport=udp",
      "turn:turn.cloudflare.com:3478?transport=tcp",
      "turns:turn.cloudflare.com:5349?transport=tcp",
      "turns:turn.cloudflare.com:443?transport=tcp",
    ],
    username: "u",
    credential: "c",
  },
];

describe("ICE configuration", () => {
  it("falls back to Cloudflare's free STUN server", () => {
    expect(STUN_URL).toBe("stun:stun.cloudflare.com:3478");
    expect(STUN_ONLY).toEqual({ iceServers: [{ urls: [STUN_URL] }], turn: false });
  });

  it("drops the port-53 urls browsers time out on, and keeps the rest", () => {
    const kept = withoutPort53(CLOUDFLARE_SHAPE);
    expect(kept[0].urls).toEqual(["stun:stun.cloudflare.com:3478"]);
    expect(kept[1].urls).toEqual([
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turn:turn.cloudflare.com:3478?transport=tcp",
      "turns:turn.cloudflare.com:5349?transport=tcp",
      "turns:turn.cloudflare.com:443?transport=tcp",
    ]);
    expect(kept[1].username).toBe("u");
  });

  it("drops a server whose only url was on port 53", () => {
    expect(withoutPort53([{ urls: "stun:stun.cloudflare.com:53" }])).toEqual([]);
  });

  it("knows whether a TURN relay is on offer", () => {
    expect(hasTurn(CLOUDFLARE_SHAPE)).toBe(true);
    expect(hasTurn(STUN_ONLY.iceServers)).toBe(false);
  });

  it("parses what the Worker returns and refuses anything else", () => {
    expect(parseIceResponse({ iceServers: CLOUDFLARE_SHAPE, turn: true })?.iceServers).toHaveLength(2);
    expect(parseIceResponse({ iceServers: [{ urls: 3 }], turn: true })).toBeNull();
    expect(parseIceResponse({ turn: true })).toBeNull();
    expect(parseIceResponse(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/net/signalProtocol.test.ts src/net/iceConfig.test.ts`
Expected: FAIL — `Failed to resolve import "./signalProtocol"` and `Failed to resolve import "./iceConfig"`.

- [ ] **Step 3: Implement** — `src/net/signalProtocol.ts`:

```ts
/**
 * The JSON a room's Durable Object relays between two browsers.
 *
 * Compiled twice — into the Worker (worker/tsconfig.json) and into the app —
 * so it imports nothing and touches no DOM type. The room understands only the
 * envelope: who you are, who else is here, and "deliver this to the other
 * one". SDP, ICE and lobby payloads pass through it untouched, which is what
 * keeps the Durable Object a dumb pipe with nothing to keep in sync.
 *
 * Parsers return null rather than throwing, for the reason `decodePacket`
 * does: these bytes come from a machine we do not control.
 */

export type Role = "host" | "guest";

/** The host is P1 and picks the stage; the guest is P2. */
export const ROLE_PORT: Readonly<Record<Role, number>> = { host: 0, guest: 1 };

export type RoomIntent = "create" | "join";

export type RoomError = "full" | "taken" | "not-found" | "bad-message" | "too-many-messages";

/**
 * WebSocket close codes the room uses. 4000–4999 is the range RFC 6455 leaves
 * to applications, and the browser cannot read an HTTP status off a failed
 * upgrade — so a refusal is an accepted socket that says why and then closes.
 */
export const ROOM_CLOSE_CODES: Readonly<Record<RoomError, number>> = {
  full: 4001,
  taken: 4002,
  "not-found": 4003,
  "bad-message": 4004,
  "too-many-messages": 4008,
};

/** A WebSocket attachment caps at 16 KiB; no signalling message needs more. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * Per socket. A connection exchanges an offer, an answer, a few dozen ICE
 * candidates and a handful of lobby picks; two thousand is generous for that
 * and still bounds what one misbehaving tab can bill against the free tier's
 * 100k requests a day (incoming WebSocket messages count 20:1, R§5).
 */
export const MAX_MESSAGES_PER_PEER = 2000;

export interface PeerInfo {
  readonly id: string;
  readonly role: Role;
}

export interface WireIceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly usernameFragment: string | null;
}

export type SignalPayload =
  | { readonly kind: "offer"; readonly sdp: string }
  | { readonly kind: "answer"; readonly sdp: string }
  | { readonly kind: "ice"; readonly candidate: WireIceCandidate };

/** A lobby payload, as the room sees it: something with a short `kind`. */
export interface OpaquePayload {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export type ClientMessage =
  | { readonly t: "signal"; readonly payload: SignalPayload }
  | { readonly t: "lobby"; readonly payload: OpaquePayload };

export type ServerMessage =
  | { readonly t: "welcome"; readonly self: PeerInfo; readonly peer: PeerInfo | null }
  | { readonly t: "peer-joined"; readonly peer: PeerInfo }
  | { readonly t: "peer-left"; readonly peerId: string }
  | { readonly t: "signal"; readonly from: string; readonly payload: SignalPayload }
  | { readonly t: "lobby"; readonly from: string; readonly payload: OpaquePayload }
  | { readonly t: "error"; readonly reason: RoomError };

const ROOM_ERRORS: readonly RoomError[] = ["full", "taken", "not-found", "bad-message", "too-many-messages"];

export function parseRoomIntent(value: string | null): RoomIntent | null {
  return value === "create" || value === "join" ? value : null;
}

/** One raw WebSocket frame from a browser. Binary frames are never valid. */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.t === "signal") {
    const payload = parseSignalPayload(value.payload);
    return payload ? { t: "signal", payload } : null;
  }
  if (value.t === "lobby") {
    const payload = value.payload;
    return isOpaquePayload(payload) ? { t: "lobby", payload } : null;
  }
  return null;
}

export function parseSignalPayload(value: unknown): SignalPayload | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  const sdp = value.sdp;
  if ((kind === "offer" || kind === "answer") && typeof sdp === "string") return { kind, sdp };
  if (kind === "ice") {
    const candidate = parseIceCandidate(value.candidate);
    return candidate ? { kind: "ice", candidate } : null;
  }
  return null;
}

/** A frame from the room, already through `JSON.parse`. */
export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "welcome": {
      const self = parsePeer(value.self);
      if (!self) return null;
      if (value.peer === null) return { t: "welcome", self, peer: null };
      const peer = parsePeer(value.peer);
      return peer ? { t: "welcome", self, peer } : null;
    }
    case "peer-joined": {
      const peer = parsePeer(value.peer);
      return peer ? { t: "peer-joined", peer } : null;
    }
    case "peer-left": {
      const peerId = value.peerId;
      return typeof peerId === "string" ? { t: "peer-left", peerId } : null;
    }
    case "signal": {
      const from = value.from;
      const payload = parseSignalPayload(value.payload);
      return payload && typeof from === "string" ? { t: "signal", from, payload } : null;
    }
    case "lobby": {
      const from = value.from;
      const payload = value.payload;
      return typeof from === "string" && isOpaquePayload(payload) ? { t: "lobby", from, payload } : null;
    }
    case "error": {
      const reason = value.reason;
      return isRoomError(reason) ? { t: "error", reason } : null;
    }
    default:
      return null;
  }
}

export function roomErrorForCloseCode(code: number): RoomError | null {
  for (const reason of ROOM_ERRORS) if (ROOM_CLOSE_CODES[reason] === code) return reason;
  return null;
}

/* ----------------------------------------------------------------- helpers -- */

function parseIceCandidate(value: unknown): WireIceCandidate | null {
  if (!isRecord(value)) return null;
  const candidate = value.candidate;
  if (typeof candidate !== "string") return null;
  const sdpMid = typeof value.sdpMid === "string" ? value.sdpMid : null;
  const index = value.sdpMLineIndex;
  const sdpMLineIndex = typeof index === "number" && Number.isInteger(index) ? index : null;
  const usernameFragment = typeof value.usernameFragment === "string" ? value.usernameFragment : null;
  return { candidate, sdpMid, sdpMLineIndex, usernameFragment };
}

function parsePeer(value: unknown): PeerInfo | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const role = value.role;
  if (typeof id !== "string" || (role !== "host" && role !== "guest")) return null;
  return { id, role };
}

function isOpaquePayload(value: unknown): value is OpaquePayload {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  return typeof kind === "string" && kind.length > 0 && kind.length <= 32;
}

function isRoomError(value: unknown): value is RoomError {
  return typeof value === "string" && (ROOM_ERRORS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

`src/net/iceConfig.ts`:

```ts
/**
 * ICE servers, in the shape the Worker returns and RTCPeerConnection wants.
 *
 * Shared by the Worker (which asks Cloudflare's TURN service) and the browser
 * (which asks the Worker), so both filter the same way and fall back to the
 * same thing. No DOM types: the Worker compiles this too.
 */

export interface IceServerWire {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface IceResponse {
  readonly iceServers: readonly IceServerWire[];
  /** True when a TURN relay is among the servers. */
  readonly turn: boolean;
}

/** Cloudflare's STUN server: free, unlimited, no key (R§5). */
export const STUN_URL = "stun:stun.cloudflare.com:3478";

/** What a match gets with no TURN key configured: direct and LAN paths only. */
export const STUN_ONLY: IceResponse = { iceServers: [{ urls: [STUN_URL] }], turn: false };

/** Browsers block port 53, and a TURN url on it times out (Cloudflare's TURN docs). */
const PORT_53 = /:53(\?|$)/;

export function urlsOf(server: IceServerWire): readonly string[] {
  return typeof server.urls === "string" ? [server.urls] : server.urls;
}

export function withoutPort53(servers: readonly IceServerWire[]): IceServerWire[] {
  const out: IceServerWire[] = [];
  for (const server of servers) {
    const kept = urlsOf(server).filter((url) => !PORT_53.test(url));
    if (kept.length > 0) out.push({ ...server, urls: kept });
  }
  return out;
}

export function hasTurn(servers: readonly IceServerWire[]): boolean {
  return servers.some((s) => urlsOf(s).some((url) => url.startsWith("turn:") || url.startsWith("turns:")));
}

export function parseIceServers(value: unknown): IceServerWire[] | null {
  if (!Array.isArray(value)) return null;
  const out: IceServerWire[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    const urls = record.urls;
    const list =
      typeof urls === "string"
        ? [urls]
        : Array.isArray(urls) && urls.every((u) => typeof u === "string")
          ? (urls as string[])
          : null;
    if (!list) return null;
    out.push({
      urls: list,
      ...(typeof record.username === "string" ? { username: record.username } : {}),
      ...(typeof record.credential === "string" ? { credential: record.credential } : {}),
    });
  }
  return out;
}

export function parseIceResponse(value: unknown): IceResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const iceServers = parseIceServers(record.iceServers);
  if (!iceServers) return null;
  return { iceServers, turn: record.turn === true };
}
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/net/signalProtocol.test.ts src/net/iceConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/net/signalProtocol.ts super-smash/src/net/signalProtocol.test.ts super-smash/src/net/iceConfig.ts super-smash/src/net/iceConfig.test.ts
git commit -m "super-smash: the room's signalling protocol and ICE config, shared with the Worker" -m "Envelope-only JSON the Durable Object relays (welcome, peer-joined/left, signal, lobby, error) with null-returning parsers; ICE server shape, STUN fallback and the port-53 filter." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: The room's rules as pure functions (`worker/src/room.ts`)

**Files:**
- Create: `super-smash/worker/src/room.ts`, `super-smash/worker/src/room.test.ts`
- Modify: `super-smash/vitest.config.mts:9` (include worker tests)

**Interfaces:**
- Consumes: `parseClientMessage`, `ROOM_CLOSE_CODES`, `MAX_MESSAGES_PER_PEER`, `PeerInfo`, `Role`, `RoomError`, `RoomIntent`, `ServerMessage` (Task 4).
- Produces:
```ts
export interface PeerAttachment extends PeerInfo { readonly received: number }
export interface Delivery { readonly to: string; readonly message: ServerMessage }
export type JoinDecision =
  | { type: "admit"; peer: PeerInfo; welcome: ServerMessage; notify: Delivery | null }
  | { type: "reject"; reason: RoomError; closeCode: number; message: ServerMessage };
export type RelayOutcome =
  | { type: "forward"; delivery: Delivery } | { type: "reply"; message: ServerMessage } | { type: "drop" }
  | { type: "kick"; reason: RoomError; closeCode: number; message: ServerMessage };
export const ROOM_CAPACITY = 2;
export function decideJoin(existing: readonly PeerInfo[], intent: RoomIntent, newId: string): JoinDecision;
export function relay(from: PeerAttachment, raw: string | ArrayBuffer, peers: readonly PeerInfo[]): RelayOutcome;
export function departures(left: PeerInfo, peers: readonly PeerInfo[]): Delivery[];
```

- [ ] **Step 1: Let vitest see worker tests** — in `vitest.config.mts` replace `include: ["src/**/*.test.{ts,tsx}"],` with `include: ["src/**/*.test.{ts,tsx}", "worker/**/*.test.ts"],`.

- [ ] **Step 2: Write the failing test** — `worker/src/room.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { MAX_MESSAGES_PER_PEER, ROOM_CLOSE_CODES, type PeerInfo } from "../../src/net/signalProtocol";
import { decideJoin, departures, relay, type PeerAttachment } from "./room";

const host: PeerInfo = { id: "h1", role: "host" };
const guest: PeerInfo = { id: "g1", role: "guest" };
const attach = (peer: PeerInfo, received = 0): PeerAttachment => ({ ...peer, received });
const offer = JSON.stringify({ t: "signal", payload: { kind: "offer", sdp: "v=0" } });

describe("joining a room", () => {
  it("makes whoever creates an empty room the host", () => {
    expect(decideJoin([], "create", "h1")).toEqual({
      type: "admit",
      peer: host,
      welcome: { t: "welcome", self: host, peer: null },
      notify: null,
    });
  });

  it("makes the second arrival the guest, and tells the host", () => {
    expect(decideJoin([host], "join", "g1")).toEqual({
      type: "admit",
      peer: guest,
      welcome: { t: "welcome", self: guest, peer: host },
      notify: { to: "h1", message: { t: "peer-joined", peer: guest } },
    });
  });

  it("turns a third peer away with 'full' and leaves the two alone", () => {
    expect(decideJoin([host, guest], "join", "x1")).toEqual({
      type: "reject",
      reason: "full",
      closeCode: ROOM_CLOSE_CODES.full,
      message: { t: "error", reason: "full" },
    });
    expect(decideJoin([host, guest], "create", "x1")).toMatchObject({ type: "reject", reason: "full" });
  });

  it("refuses to create a room somebody is already in", () => {
    expect(decideJoin([host], "create", "h2")).toMatchObject({ type: "reject", reason: "taken" });
  });

  it("refuses to join a room nobody created, which is what a mistyped code looks like", () => {
    expect(decideJoin([], "join", "g1")).toMatchObject({ type: "reject", reason: "not-found" });
  });

  it("never leaks the room's own bookkeeping into a welcome", () => {
    const attachment = { ...host, received: 41 };
    expect(decideJoin([attachment], "join", "g1")).toMatchObject({ welcome: { t: "welcome", self: guest, peer: host } });
    const decision = decideJoin([attachment], "join", "g1");
    expect(decision.type === "admit" && decision.welcome.t === "welcome" ? decision.welcome.peer : null).toEqual(host);
  });

  it("hands the host seat to a newcomer if the host left first", () => {
    expect(decideJoin([guest], "join", "h2")).toMatchObject({ type: "admit", peer: { id: "h2", role: "host" } });
  });
});

describe("relaying", () => {
  it("forwards a signal to the other peer, stamped with who sent it", () => {
    expect(relay(attach(host), offer, [host, guest])).toEqual({
      type: "forward",
      delivery: { to: "g1", message: { t: "signal", from: "h1", payload: { kind: "offer", sdp: "v=0" } } },
    });
  });

  it("cannot be talked into a forged sender", () => {
    const forged = JSON.stringify({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 0 } });
    expect(relay(attach(host), forged, [host, guest])).toEqual({
      type: "forward",
      delivery: { to: "g1", message: { t: "lobby", from: "h1", payload: { kind: "pick", fighterId: "fox", costume: 0 } } },
    });
  });

  it("answers garbage with bad-message instead of passing it on", () => {
    const bad = { type: "reply", message: { t: "error", reason: "bad-message" } };
    expect(relay(attach(host), "{nope", [host, guest])).toEqual(bad);
    expect(relay(attach(host), new ArrayBuffer(8), [host, guest])).toEqual(bad);
  });

  it("drops a message when nobody else is in the room", () => {
    expect(relay(attach(host), offer, [host])).toEqual({ type: "drop" });
  });

  it("closes a socket that floods the room", () => {
    expect(relay(attach(host, MAX_MESSAGES_PER_PEER), offer, [host, guest])).toEqual({
      type: "kick",
      reason: "too-many-messages",
      closeCode: ROOM_CLOSE_CODES["too-many-messages"],
      message: { t: "error", reason: "too-many-messages" },
    });
  });
});

describe("leaving", () => {
  it("tells whoever is left", () => {
    expect(departures(guest, [host, guest])).toEqual([{ to: "h1", message: { t: "peer-left", peerId: "g1" } }]);
  });

  it("tells nobody when the room is now empty", () => {
    expect(departures(host, [host])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run worker/src/room.test.ts`
Expected: FAIL — `Failed to resolve import "./room" from "worker/src/room.test.ts"`.

- [ ] **Step 4: Implement** — `worker/src/room.ts`:

```ts
/**
 * A room's rules, with no Cloudflare in them.
 *
 * The Durable Object (roomDO.ts) is a thin shell that maps these decisions onto
 * sockets; everything that can be wrong lives here, where a plain vitest run
 * can see it. A room holds two peers: the first in is the host (P1, picks the
 * stage), the second the guest. It relays envelopes and understands nothing
 * inside them.
 */

import {
  MAX_MESSAGES_PER_PEER,
  ROOM_CLOSE_CODES,
  parseClientMessage,
  type PeerInfo,
  type Role,
  type RoomError,
  type RoomIntent,
  type ServerMessage,
} from "../../src/net/signalProtocol";

/** What the Durable Object keeps on each socket (`serializeAttachment`). */
export interface PeerAttachment extends PeerInfo {
  /** Messages this socket has sent, for the flood cap. */
  readonly received: number;
}

export interface Delivery {
  readonly to: string;
  readonly message: ServerMessage;
}

export type JoinDecision =
  | { readonly type: "admit"; readonly peer: PeerInfo; readonly welcome: ServerMessage; readonly notify: Delivery | null }
  | { readonly type: "reject"; readonly reason: RoomError; readonly closeCode: number; readonly message: ServerMessage };

export type RelayOutcome =
  | { readonly type: "forward"; readonly delivery: Delivery }
  | { readonly type: "reply"; readonly message: ServerMessage }
  | { readonly type: "drop" }
  | { readonly type: "kick"; readonly reason: RoomError; readonly closeCode: number; readonly message: ServerMessage };

/** v1 online is two players (spec §3.3). */
export const ROOM_CAPACITY = 2;

export function decideJoin(existing: readonly PeerInfo[], intent: RoomIntent, newId: string): JoinDecision {
  if (existing.length >= ROOM_CAPACITY) return { type: "reject", ...refusal("full") };
  // A fresh code that is already in use: the creator makes another one.
  if (intent === "create" && existing.length > 0) return { type: "reject", ...refusal("taken") };
  // Joining an empty room means the code was misheard or the host has gone.
  if (intent === "join" && existing.length === 0) return { type: "reject", ...refusal("not-found") };

  const role: Role = existing.some((p) => p.role === "host") ? "guest" : "host";
  const peer: PeerInfo = { id: newId, role };
  // Rebuilt rather than passed through: the room hands in its socket
  // attachments, which also carry the private `received` counter.
  const first = existing[0];
  const other: PeerInfo | null = first ? { id: first.id, role: first.role } : null;
  return {
    type: "admit",
    peer,
    welcome: { t: "welcome", self: peer, peer: other },
    notify: other ? { to: other.id, message: { t: "peer-joined", peer } } : null,
  };
}

export function relay(from: PeerAttachment, raw: string | ArrayBuffer, peers: readonly PeerInfo[]): RelayOutcome {
  if (from.received >= MAX_MESSAGES_PER_PEER) return { type: "kick", ...refusal("too-many-messages") };
  const message = parseClientMessage(raw);
  if (!message) return { type: "reply", message: { t: "error", reason: "bad-message" } };
  const other = peers.find((p) => p.id !== from.id);
  if (!other) return { type: "drop" };
  // The sender is stamped here, never read from the message.
  const relayed: ServerMessage =
    message.t === "signal"
      ? { t: "signal", from: from.id, payload: message.payload }
      : { t: "lobby", from: from.id, payload: message.payload };
  return { type: "forward", delivery: { to: other.id, message: relayed } };
}

export function departures(left: PeerInfo, peers: readonly PeerInfo[]): Delivery[] {
  return peers
    .filter((p) => p.id !== left.id)
    .map((p) => ({ to: p.id, message: { t: "peer-left", peerId: left.id } }));
}

function refusal(reason: RoomError): { reason: RoomError; closeCode: number; message: ServerMessage } {
  return { reason, closeCode: ROOM_CLOSE_CODES[reason], message: { t: "error", reason } };
}
```

- [ ] **Step 5: Run the test again**

Run: `pnpm vitest run worker/src/room.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. (The root `tsc` still includes `worker/` at this point; `room.ts` imports nothing Cloudflare-specific, so it compiles under the app's config.)

- [ ] **Step 7: Commit**

```bash
git add super-smash/worker/src/room.ts super-smash/worker/src/room.test.ts super-smash/vitest.config.mts
git commit -m "super-smash: room rules for the signalling Durable Object, as pure functions" -m "Two peers per room (host then guest), a third is turned away as full; create on an occupied code is taken, join on an empty one is not-found; relays stamp the sender and cap a flooding socket." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Mint TURN credentials, or fall back to STUN (`worker/src/ice.ts`)

**Files:**
- Create: `super-smash/worker/src/ice.ts`, `super-smash/worker/src/ice.test.ts`

**Interfaces:**
- Consumes: `STUN_ONLY`, `withoutPort53`, `hasTurn`, `parseIceServers`, `IceResponse` (Task 4).
- Produces:
```ts
export const TURN_TTL_SECONDS: number; // 14400 (4 h; spec: ≤ 48 h)
export interface TurnEnv { readonly TURN_KEY_ID?: string; readonly TURN_KEY_API_TOKEN?: string }
export interface FetchInit { readonly method: "POST"; readonly headers: Readonly<Record<string, string>>; readonly body: string }
export interface FetchResult { readonly ok: boolean; readonly status: number; json(): Promise<unknown> }
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResult>;
export function turnCredentialsUrl(keyId: string): string;
export function iceServersFor(env: TurnEnv, fetchFn: FetchLike): Promise<IceResponse>;
```

- [ ] **Step 1: Write the failing test** — `worker/src/ice.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { STUN_ONLY } from "../../src/net/iceConfig";
import { TURN_TTL_SECONDS, iceServersFor, turnCredentialsUrl, type FetchLike } from "./ice";

/** The 201 body Cloudflare documents, including the port-53 urls browsers choke on. */
const CLOUDFLARE_201 = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "u",
      credential: "c",
    },
  ],
};

function respond(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

const ENV = { TURN_KEY_ID: "key-1", TURN_KEY_API_TOKEN: "tok" };

describe("/api/ice", () => {
  it("answers STUN-only, without calling Cloudflare, when no TURN key is set", async () => {
    const fetchFn = respond(201, CLOUDFLARE_201);
    await expect(iceServersFor({}, fetchFn)).resolves.toEqual(STUN_ONLY);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers STUN-only when only half the secret pair is set", async () => {
    const fetchFn = respond(201, CLOUDFLARE_201);
    await expect(iceServersFor({ TURN_KEY_ID: "key-1" }, fetchFn)).resolves.toEqual(STUN_ONLY);
    await expect(iceServersFor({ TURN_KEY_ID: "  ", TURN_KEY_API_TOKEN: "tok" }, fetchFn)).resolves.toEqual(STUN_ONLY);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("asks Cloudflare for four-hour credentials with the key's bearer token", async () => {
    const fetchFn = respond(201, CLOUDFLARE_201);
    await iceServersFor(ENV, fetchFn);
    expect(TURN_TTL_SECONDS).toBe(4 * 60 * 60);
    expect(turnCredentialsUrl("key-1")).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers",
    );
    expect(fetchFn).toHaveBeenCalledWith(turnCredentialsUrl("key-1"), {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 14400 }),
    });
  });

  it("returns the relay, minus the port-53 urls", async () => {
    const out = await iceServersFor(ENV, respond(201, CLOUDFLARE_201));
    expect(out.turn).toBe(true);
    const urls = out.iceServers.flatMap((s) => (typeof s.urls === "string" ? [s.urls] : [...s.urls]));
    expect(urls.some((u) => /:53(\?|$)/.test(u))).toBe(false);
    expect(out.iceServers[1]).toMatchObject({ username: "u", credential: "c" });
  });

  it("accepts a single iceServers object as well as an array", async () => {
    const single = { iceServers: { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" } };
    const out = await iceServersFor(ENV, respond(201, single));
    expect(out).toEqual({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" }], turn: true });
  });

  it("falls back to STUN when Cloudflare refuses, throws, or answers nonsense", async () => {
    await expect(iceServersFor(ENV, respond(401, { errors: [] }))).resolves.toEqual(STUN_ONLY);
    await expect(iceServersFor(ENV, respond(201, { nope: true }))).resolves.toEqual(STUN_ONLY);
    const throwing = vi.fn<FetchLike>(async () => {
      throw new Error("network down");
    });
    await expect(iceServersFor(ENV, throwing)).resolves.toEqual(STUN_ONLY);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run worker/src/ice.test.ts`
Expected: FAIL — `Failed to resolve import "./ice" from "worker/src/ice.test.ts"`.

- [ ] **Step 3: Implement** — `worker/src/ice.ts`:

```ts
/**
 * `GET /api/ice`: short-lived Cloudflare TURN credentials, or STUN alone.
 *
 * TURN is what makes the game work across the NATs a direct connection cannot
 * cross — the replica's documented "no TURN" gap (R§5). It is optional on
 * purpose: with no key configured, or with the TURN API down, the answer is
 * STUN-only and every LAN and most home connections still work. A failure
 * here must never be the reason a lobby cannot start.
 *
 * The API (developers.cloudflare.com/realtime/turn/generate-credentials):
 * POST …/turn/keys/<TURN_KEY_ID>/credentials/generate-ice-servers with a
 * bearer token and {"ttl": seconds}; 201 with { iceServers: [...] }.
 */

import { STUN_ONLY, hasTurn, parseIceServers, withoutPort53, type IceResponse } from "../../src/net/iceConfig";

/** Four hours: longer than any session, far under the spec's 48 h ceiling. */
export const TURN_TTL_SECONDS = 4 * 60 * 60;

export interface TurnEnv {
  readonly TURN_KEY_ID?: string;
  readonly TURN_KEY_API_TOKEN?: string;
}

export interface FetchInit {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface FetchResult {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResult>;

export function turnCredentialsUrl(keyId: string): string {
  return `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
}

export async function iceServersFor(env: TurnEnv, fetchFn: FetchLike): Promise<IceResponse> {
  const keyId = env.TURN_KEY_ID?.trim();
  const token = env.TURN_KEY_API_TOKEN?.trim();
  if (!keyId || !token) return STUN_ONLY;
  try {
    const res = await fetchFn(turnCredentialsUrl(keyId), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });
    if (!res.ok) return STUN_ONLY;
    const body = await res.json();
    const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>).iceServers : undefined;
    // The docs show an array; a single server object is accepted too, rather
    // than silently degrading to STUN over a shape difference.
    const list = Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null ? [raw] : null;
    const servers = list ? parseIceServers(list) : null;
    if (!servers) return STUN_ONLY;
    const usable = withoutPort53(servers);
    return usable.length > 0 ? { iceServers: usable, turn: hasTurn(usable) } : STUN_ONLY;
  } catch {
    return STUN_ONLY;
  }
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run worker/src/ice.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/worker/src/ice.ts super-smash/worker/src/ice.test.ts
git commit -m "super-smash: mint 4-hour Cloudflare TURN credentials, STUN-only when unconfigured" -m "Missing or half-set secrets, a refused or failing TURN API, or a junk body all answer STUN-only; port-53 urls are dropped." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The `david-smash` Worker: static assets, `/api/ice`, `/ws/room/:code` → `RoomDO`

**Files:**
- Create: `super-smash/wrangler.jsonc`, `super-smash/worker/tsconfig.json`, `super-smash/worker/src/env.ts`, `super-smash/worker/src/routes.ts`, `super-smash/worker/src/routes.test.ts`, `super-smash/worker/src/roomDO.ts`, `super-smash/worker/src/index.ts`, `super-smash/src/net/roomWorker.integration.test.ts`
- Modify: `super-smash/package.json` (devDeps, scripts), `super-smash/pnpm-lock.yaml`, `super-smash/pnpm-workspace.yaml`, `super-smash/tsconfig.json:29` (exclude `worker`, `.wrangler`), `super-smash/eslint.config.mjs:8-17` (ignore `.wrangler/**`), `super-smash/.gitignore`

**Interfaces:**
- Consumes: `decideJoin`, `relay`, `departures`, `PeerAttachment`, `Delivery` (Task 5); `iceServersFor` (Task 6); `normalizeRoomCode` (Task 3); `parseRoomIntent`, `ServerMessage`, `ROOM_CLOSE_CODES` (Task 4).
- Produces: `export type Route = { kind: "ice" } | { kind: "room"; code: string } | { kind: "not-found" } | { kind: "assets" }`, `export function routeFor(method: string, pathname: string): Route`; `export interface Env { ROOMS: DurableObjectNamespace<RoomDO>; ASSETS: Fetcher; TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string }`; `export class RoomDO extends DurableObject<Env>`; HTTP: `GET /api/ice` → `IceResponse` JSON (`Cache-Control: no-store`); `GET /ws/room/:CODE?intent=create|join` (WebSocket) → room protocol of Task 4.
- Scripts: `pnpm typecheck` (app + worker), `pnpm preview` (build + `wrangler dev` on :8787), `pnpm run deploy` (build + `wrangler deploy`; outward — Task 24 only).

- [ ] **Step 1: Install wrangler and the Workers types (versions pinned; both published ≥ 3 weeks ago and matching the Leaders precedent)**

Run: `pnpm add -D wrangler@4.146.0 @cloudflare/workers-types@5.20261001.1`

Then replace `pnpm-workspace.yaml` with:

```yaml
allowBuilds:
  unrs-resolver: true
  # wrangler bundles with esbuild and runs Workers locally in workerd; both
  # ship platform binaries through install scripts.
  esbuild: true
  workerd: true
  # Miniflare's optional image binding; nothing here uses it.
  sharp: false
```

Run: `pnpm install`
Expected: no "Ignored build scripts" warning. If pnpm lists another package, add it to `allowBuilds` (`true` only for `esbuild`/`workerd`, `false` otherwise) and rerun.

- [ ] **Step 2: Write the failing test** — `worker/src/routes.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { routeFor } from "./routes";

describe("routing", () => {
  it("sends GET /api/ice to the TURN minting", () => {
    expect(routeFor("GET", "/api/ice")).toEqual({ kind: "ice" });
  });

  it("refuses anything but GET on /api/ice", () => {
    expect(routeFor("POST", "/api/ice")).toEqual({ kind: "not-found" });
  });

  it("sends a room socket to its Durable Object by code", () => {
    expect(routeFor("GET", "/ws/room/ABCD")).toEqual({ kind: "room", code: "ABCD" });
  });

  it("refuses a code the browser did not normalise, or one that cannot exist", () => {
    for (const path of ["/ws/room/abcd", "/ws/room/ABOD", "/ws/room/ABCDE", "/ws/room/AB", "/ws/room/ABCD/x"]) {
      expect(routeFor("GET", path)).toEqual({ kind: "not-found" });
    }
  });

  it("404s unknown /api and /ws paths instead of serving the game", () => {
    expect(routeFor("GET", "/api/nope")).toEqual({ kind: "not-found" });
    expect(routeFor("GET", "/ws/lobby")).toEqual({ kind: "not-found" });
  });

  it("leaves everything else to the static assets", () => {
    expect(routeFor("GET", "/")).toEqual({ kind: "assets" });
    expect(routeFor("GET", "/menu")).toEqual({ kind: "assets" });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run worker/src/routes.test.ts`
Expected: FAIL — `Failed to resolve import "./routes" from "worker/src/routes.test.ts"`.

- [ ] **Step 4: Implement the Worker** — `worker/src/routes.ts`:

```ts
import { normalizeRoomCode } from "../../src/net/roomCode";

export type Route =
  | { readonly kind: "ice" }
  | { readonly kind: "room"; readonly code: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "assets" };

const ROOM_PATH = /^\/ws\/room\/([A-Za-z0-9-]{1,16})$/;

/**
 * Where a request goes. wrangler.jsonc runs the Worker first only for /api/*
 * and /ws/*; everything else is served from out/ before this runs, so
 * "assets" is only reached for paths the asset layer handed back.
 */
export function routeFor(method: string, pathname: string): Route {
  if (pathname === "/api/ice") return method === "GET" ? { kind: "ice" } : { kind: "not-found" };
  const room = ROOM_PATH.exec(pathname);
  if (room) {
    // Exact after normalising: the browser normalises before it connects, so
    // anything else did not come from our client.
    const code = normalizeRoomCode(room[1]);
    return code !== null && code === room[1] ? { kind: "room", code } : { kind: "not-found" };
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/ws/")) return { kind: "not-found" };
  return { kind: "assets" };
}
```

`worker/src/env.ts`:

```ts
import type { RoomDO } from "./roomDO";

/** Bindings from wrangler.jsonc, plus the two secrets David sets with `wrangler secret put`. */
export interface Env {
  readonly ROOMS: DurableObjectNamespace<RoomDO>;
  readonly ASSETS: Fetcher;
  readonly TURN_KEY_ID?: string;
  readonly TURN_KEY_API_TOKEN?: string;
}
```

`worker/src/roomDO.ts`:

```ts
import { DurableObject } from "cloudflare:workers";

import { parseRoomIntent, type ServerMessage } from "../../src/net/signalProtocol";
import type { Env } from "./env";
import { decideJoin, departures, relay, type Delivery, type PeerAttachment } from "./room";

/**
 * One room: at most two sockets, and a pipe between them.
 *
 * Every rule lives in ./room.ts as a pure function; this class only maps those
 * decisions onto sockets. It uses the WebSocket Hibernation API
 * (`ctx.acceptWebSocket`), so an idle lobby costs nothing, and it never sets a
 * timer: a 60 Hz loop here would keep the object awake, which spec §3.1
 * forbids. The match never touches it — once the DataChannel opens, inputs go
 * peer to peer — so the restart every deploy causes drops only the lobby
 * sockets, not a match in progress.
 *
 * SQLite-backed because that is the only Durable Object storage the Free plan
 * offers. v1 keeps all its state in socket attachments and stores nothing.
 */
export class RoomDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const intent = parseRoomIntent(new URL(request.url).searchParams.get("intent"));
    if (request.headers.get("Upgrade") !== "websocket" || intent === null) {
      return new Response("Expected a WebSocket upgrade with ?intent=create|join", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const decision = decideJoin(this.peers(), intent, crypto.randomUUID().slice(0, 8));

    if (decision.type === "reject") {
      // Accepted only long enough to say why: a browser cannot read the HTTP
      // status of a refused upgrade, only a close code.
      server.accept();
      send(server, decision.message);
      server.close(decision.closeCode, decision.reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    const attachment: PeerAttachment = { ...decision.peer, received: 0 };
    server.serializeAttachment(attachment);
    send(server, decision.welcome);
    if (decision.notify) this.deliver(decision.notify);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const from = ws.deserializeAttachment() as PeerAttachment | null;
    if (!from) return;
    const outcome = relay(from, message, this.peers());
    const counted: PeerAttachment = { ...from, received: from.received + 1 };
    ws.serializeAttachment(counted);
    switch (outcome.type) {
      case "forward":
        this.deliver(outcome.delivery);
        break;
      case "reply":
        send(ws, outcome.message);
        break;
      case "kick":
        send(ws, outcome.message);
        ws.close(outcome.closeCode, outcome.reason);
        break;
      case "drop":
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.depart(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.depart(ws);
  }

  private depart(ws: WebSocket): void {
    const left = ws.deserializeAttachment() as PeerAttachment | null;
    if (!left) return;
    for (const delivery of departures(left, this.peers())) this.deliver(delivery);
  }

  private peers(): PeerAttachment[] {
    const out: PeerAttachment[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const peer = ws.deserializeAttachment() as PeerAttachment | null;
      if (peer) out.push(peer);
    }
    return out;
  }

  private deliver(delivery: Delivery): void {
    for (const ws of this.ctx.getWebSockets()) {
      const peer = ws.deserializeAttachment() as PeerAttachment | null;
      if (peer?.id === delivery.to) send(ws, delivery.message);
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // The socket is already closing; its own close handler tells the other side.
  }
}
```

`worker/src/index.ts`:

```ts
import type { Env } from "./env";
import { iceServersFor } from "./ice";
import { routeFor } from "./routes";

export { RoomDO } from "./roomDO";

/** The client gives up on /api/ice after 4 s (src/net/iceServers.ts); answer sooner. */
const TURN_API_TIMEOUT_MS = 3000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const route = routeFor(request.method, new URL(request.url).pathname);
    switch (route.kind) {
      case "ice": {
        const body = await iceServersFor(env, (url, init) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(TURN_API_TIMEOUT_MS) }),
        );
        return Response.json(body, { headers: { "Cache-Control": "no-store" } });
      }
      case "room": {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("Expected a WebSocket upgrade", { status: 426 });
        }
        return env.ROOMS.get(env.ROOMS.idFromName(route.code)).fetch(request);
      }
      case "not-found":
        return Response.json({ error: "not found" }, { status: 404 });
      case "assets":
        return env.ASSETS.fetch(request);
    }
  },
} satisfies ExportedHandler<Env>;
```

`wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  // https://david-smash.leaders-game.workers.dev — David's existing free account
  // (the one hosting leaders.leaders-game.workers.dev). Free plan only (spec §3.1).
  "name": "david-smash",
  "main": "worker/src/index.ts",
  // On or after 2026-04-07, so the runtime auto-replies to WebSocket Close
  // frames (web_socket_auto_reply_to_close).
  "compatibility_date": "2026-10-01",
  "assets": {
    // `pnpm build` (output: "export") writes the whole game here.
    "directory": "./out",
    "binding": "ASSETS",
    // Next's export writes out/404.html.
    "not_found_handling": "404-page",
    // The Worker runs only for the API and the room sockets; every page and
    // chunk is served straight from the asset layer, which is free.
    "run_worker_first": ["/api/*", "/ws/*"]
  },
  "durable_objects": {
    "bindings": [{ "name": "ROOMS", "class_name": "RoomDO" }]
  },
  // SQLite-backed: the only Durable Object storage on the Free plan.
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomDO"] }]
}
```

`worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "../src/net/signalProtocol.ts", "../src/net/iceConfig.ts", "../src/net/roomCode.ts"]
}
```

`tsconfig.json`: replace `"exclude": ["node_modules"]` with `"exclude": ["node_modules", "worker", ".wrangler"]` (the Worker has its own lib and types; mixing DOM and Workers globals in one program conflicts; `.wrangler/` holds wrangler's generated bundles).

`eslint.config.mjs`: in `globalIgnores([...])`, after `"test-results/**",` add `".wrangler/**",`.

`package.json` scripts: replace `"start": "next start",` with `"preview": "next build && wrangler dev --port 8787",` and add `"deploy": "next build && wrangler deploy",`; replace `"typecheck": "tsc --noEmit"` with `"typecheck": "tsc --noEmit && tsc --noEmit -p worker/tsconfig.json"`.

`.gitignore`: append

```
# wrangler's local state and local secrets (TURN_KEY_ID / TURN_KEY_API_TOKEN for `wrangler dev`).
.wrangler/
.dev.vars
.dev.vars.*
```

`src/net/roomWorker.integration.test.ts` (lives under `src/` so the app's tsconfig — DOM `WebSocket`, Node `process` — typechecks it; Node 26 has a global `WebSocket`):

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseIceResponse } from "./iceConfig";
import { makeRoomCode } from "./roomCode";
import { ROOM_CLOSE_CODES, type RoomIntent } from "./signalProtocol";

/**
 * Against a running Worker — `pnpm preview` locally, or the deployed URL.
 * Skipped in the ordinary `pnpm test`:
 *   WORKER_URL=http://localhost:8787 pnpm vitest run src/net/roomWorker.integration.test.ts
 */
const WORKER_URL = process.env.WORKER_URL;

interface Client {
  readonly closed: Promise<number>;
  send(value: unknown): void;
  next(t: string): Promise<Record<string, unknown>>;
  close(): void;
}

function connect(code: string, intent: RoomIntent): Client {
  const base = (WORKER_URL ?? "").replace(/^http/, "ws");
  const ws = new WebSocket(`${base}/ws/room/${code}?intent=${intent}`);
  const messages: Record<string, unknown>[] = [];
  ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data)) as Record<string, unknown>));
  const opened = new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
  return {
    closed,
    send: (value) => void opened.then(() => ws.send(JSON.stringify(value))),
    async next(t) {
      for (let waited = 0; waited < 5000; waited += 25) {
        const index = messages.findIndex((m) => m.t === t);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`no "${t}" within 5 s; saw ${JSON.stringify(messages)}`);
    },
    close: () => ws.close(1000, "done"),
  };
}

describe.skipIf(!WORKER_URL)("a live room (WORKER_URL)", () => {
  it("admits a host and a guest, relays between them, and turns a third away", async () => {
    const code = makeRoomCode();
    const host = connect(code, "create");
    expect(await host.next("welcome")).toMatchObject({ self: { role: "host" }, peer: null });
    const guest = connect(code, "join");
    expect(await guest.next("welcome")).toMatchObject({ self: { role: "guest" }, peer: { role: "host" } });
    expect(await host.next("peer-joined")).toMatchObject({ peer: { role: "guest" } });

    host.send({ t: "signal", payload: { kind: "offer", sdp: "v=0" } });
    expect(await guest.next("signal")).toMatchObject({ payload: { kind: "offer", sdp: "v=0" } });

    const third = connect(code, "join");
    expect(await third.next("error")).toEqual({ t: "error", reason: "full" });
    expect(await third.closed).toBe(ROOM_CLOSE_CODES.full);

    guest.close();
    expect(await host.next("peer-left")).toMatchObject({ t: "peer-left" });
    host.close();
  });

  it("tells a mistyped code there is no such room", async () => {
    const lonely = connect(makeRoomCode(), "join");
    expect(await lonely.next("error")).toEqual({ t: "error", reason: "not-found" });
    expect(await lonely.closed).toBe(ROOM_CLOSE_CODES["not-found"]);
  });

  it("serves ICE servers at /api/ice, uncached", async () => {
    const res = await fetch(`${WORKER_URL}/api/ice`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(parseIceResponse(await res.json())).not.toBeNull();
  });
});
```

- [ ] **Step 5: Run the unit tests and the typecheck**

Run: `pnpm vitest run worker/src/routes.test.ts src/net/roomWorker.integration.test.ts && pnpm typecheck`
Expected: routes PASS (6 tests); the integration file reports 3 skipped; both `tsc` programs exit 0.

- [ ] **Step 6: Exercise the real Worker locally (`wrangler dev` needs no login)**

Run (background, note the PID): `pnpm run build && WRANGLER_SEND_METRICS=false pnpm exec wrangler dev --port 8787`
Then:
```bash
curl -s http://localhost:8787/api/ice
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/menu
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/no-such-page
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/api/nope
WORKER_URL=http://localhost:8787 pnpm vitest run src/net/roomWorker.integration.test.ts
```
Expected: `{"iceServers":[{"urls":["stun:stun.cloudflare.com:3478"]}],"turn":false}`, `200`, `404`, `404`, and 3 passed. Stop wrangler itself, not just the pnpm chain that started it (killing the pnpm PID leaves wrangler and workerd holding :8787): `kill $(lsof -ti tcp:8787)`, then confirm `lsof -ti tcp:8787` prints nothing. Never `pkill -f`.

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/eslint.config.mjs super-smash/wrangler.jsonc super-smash/worker/tsconfig.json super-smash/worker/src/env.ts super-smash/worker/src/routes.ts super-smash/worker/src/routes.test.ts super-smash/worker/src/roomDO.ts super-smash/worker/src/index.ts super-smash/src/net/roomWorker.integration.test.ts super-smash/package.json super-smash/pnpm-lock.yaml super-smash/pnpm-workspace.yaml super-smash/tsconfig.json super-smash/.gitignore
git commit -m "super-smash: the david-smash Worker — static assets, /api/ice, and a hibernating RoomDO per room" -m "wrangler.jsonc serves out/ and runs the Worker first only for /api/* and /ws/*. /ws/room/:code goes to a SQLite-backed Durable Object (idFromName) that applies worker/src/room.ts with the WebSocket Hibernation API and no timers. Integration test runs against wrangler dev with WORKER_URL." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Fetch ICE servers in the browser, never waiting long

**Files:**
- Create: `super-smash/src/net/iceServers.ts`, `super-smash/src/net/iceServers.test.ts`

**Interfaces:**
- Consumes: `STUN_ONLY`, `parseIceResponse`, `withoutPort53`, `IceResponse` (Task 4).
- Produces:
```ts
export const ICE_ENDPOINT = "/api/ice";
export const ICE_TIMEOUT_MS = 4000;
export interface IceFetchInit { readonly signal: AbortSignal; readonly cache: "no-store" }
export type IceFetch = (url: string, init: IceFetchInit) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;
export function fetchIceServers(fetchFn?: IceFetch, timeoutMs?: number): Promise<IceResponse>;
export function toRtcIceServers(response: IceResponse): RTCIceServer[];
```

- [ ] **Step 1: Write the failing test** — `src/net/iceServers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { STUN_ONLY } from "./iceConfig";
import { ICE_ENDPOINT, fetchIceServers, toRtcIceServers, type IceFetch } from "./iceServers";

const TURN = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp"], username: "u", credential: "c" },
  ],
  turn: true,
};

function answering(ok: boolean, body: unknown) {
  return vi.fn<IceFetch>(async () => ({ ok, json: async () => body }));
}

describe("fetchIceServers", () => {
  it("asks the Worker, uncached", async () => {
    const fetchFn = answering(true, STUN_ONLY);
    await fetchIceServers(fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(ICE_ENDPOINT, expect.objectContaining({ cache: "no-store" }));
  });

  it("returns the relay when the Worker has one, minus port 53", async () => {
    const out = await fetchIceServers(answering(true, TURN));
    expect(out.turn).toBe(true);
    expect(out.iceServers[1].urls).toEqual(["turn:turn.cloudflare.com:3478?transport=udp"]);
  });

  it("falls back to STUN when there is no Worker (plain next dev answers 404)", async () => {
    await expect(fetchIceServers(answering(false, "<html>"))).resolves.toEqual(STUN_ONLY);
  });

  it("falls back to STUN when the request throws or the body is junk", async () => {
    const throwing = vi.fn<IceFetch>(async () => {
      throw new Error("offline");
    });
    await expect(fetchIceServers(throwing)).resolves.toEqual(STUN_ONLY);
    await expect(fetchIceServers(answering(true, { iceServers: "nope" }))).resolves.toEqual(STUN_ONLY);
  });

  it("gives up after the timeout instead of holding the lobby", async () => {
    const hanging: IceFetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(fetchIceServers(hanging, 5)).resolves.toEqual(STUN_ONLY);
  });

  it("hands RTCPeerConnection plain, mutable arrays", () => {
    const servers = toRtcIceServers({ iceServers: [{ urls: ["turn:x:3478"], username: "u", credential: "c" }], turn: true });
    expect(servers).toEqual([{ urls: ["turn:x:3478"], username: "u", credential: "c" }]);
    expect(toRtcIceServers(STUN_ONLY)).toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/net/iceServers.test.ts`
Expected: FAIL — `Failed to resolve import "./iceServers"`.

- [ ] **Step 3: Implement** — `src/net/iceServers.ts`:

```ts
/**
 * Where the browser gets its ICE servers: the Worker's `/api/ice`.
 *
 * Every failure falls back to STUN-only, and so does slowness: the lobby waits
 * on this before it opens the room socket, and a TURN service having a bad
 * minute must cost a relay, not the match. Under `next dev` there is no Worker
 * at all, the request 404s, and the answer is the same STUN fallback.
 */

import { STUN_ONLY, parseIceResponse, withoutPort53, type IceResponse } from "./iceConfig";

export const ICE_ENDPOINT = "/api/ice";
export const ICE_TIMEOUT_MS = 4000;

export interface IceFetchInit {
  readonly signal: AbortSignal;
  readonly cache: "no-store";
}

export type IceFetch = (url: string, init: IceFetchInit) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

const browserFetch: IceFetch = (url, init) => fetch(url, init);

export async function fetchIceServers(
  fetchFn: IceFetch = browserFetch,
  timeoutMs: number = ICE_TIMEOUT_MS,
): Promise<IceResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(ICE_ENDPOINT, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return STUN_ONLY;
    const parsed = parseIceResponse(await res.json());
    if (!parsed) return STUN_ONLY;
    const usable = withoutPort53(parsed.iceServers);
    return usable.length > 0 ? { iceServers: usable, turn: parsed.turn } : STUN_ONLY;
  } catch {
    return STUN_ONLY;
  } finally {
    clearTimeout(timer);
  }
}

export function toRtcIceServers(response: IceResponse): RTCIceServer[] {
  return response.iceServers.map((server) => ({
    urls: typeof server.urls === "string" ? server.urls : [...server.urls],
    ...(server.username !== undefined ? { username: server.username } : {}),
    ...(server.credential !== undefined ? { credential: server.credential } : {}),
  }));
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/net/iceServers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/net/iceServers.ts super-smash/src/net/iceServers.test.ts
git commit -m "super-smash: fetch ICE servers from /api/ice with a 4 s cap and a STUN fallback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The room socket client (`src/net/signalling.ts`)

**Files:**
- Create: `super-smash/src/net/signalling.ts`, `super-smash/src/net/signalling.test.ts`

**Interfaces:**
- Consumes: `createEmitter`, `Unsubscribe` (`src/net/transport.ts:20,62`); `parseServerMessage`, `ClientMessage`, `ServerMessage`, `RoomIntent` (Task 4).
- Produces:
```ts
export interface WebSocketLike {
  readonly readyState: number; send(data: string): void; close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null; onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null; onerror: ((event: unknown) => void) | null;
}
export type SignallingEvent = ServerMessage | { readonly t: "closed"; readonly code: number; readonly reason: string };
export interface SignallingClient { readonly url: string; send(message: ClientMessage): void; on(cb: (event: SignallingEvent) => void): Unsubscribe; close(): void }
export interface SignallingOptions { readonly roomCode: string; readonly intent: RoomIntent; readonly origin?: string; readonly createSocket?: (url: string) => WebSocketLike }
export function roomSocketUrl(origin: string, roomCode: string, intent: RoomIntent): string;
export function createSignallingClient(options: SignallingOptions): SignallingClient;
```

- [ ] **Step 1: Write the failing test** — `src/net/signalling.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createSignallingClient, roomSocketUrl, type SignallingEvent, type WebSocketLike } from "./signalling";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  closedWith: [number | undefined, string | undefined] | null = null;
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onclose: WebSocketLike["onclose"] = null;
  onerror: WebSocketLike["onerror"] = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = [code, reason];
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(value: unknown): void {
    this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) });
  }
  drop(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function client() {
  let socket: FakeSocket | null = null;
  const signalling = createSignallingClient({
    roomCode: "ABCD",
    intent: "create",
    origin: "https://david-smash.leaders-game.workers.dev",
    createSocket: (url) => (socket = new FakeSocket(url)),
  });
  const events: SignallingEvent[] = [];
  signalling.on((event) => events.push(event));
  return { signalling, socket: socket as unknown as FakeSocket, events };
}

describe("roomSocketUrl", () => {
  it("uses wss on an https page and ws on http", () => {
    expect(roomSocketUrl("https://david-smash.leaders-game.workers.dev", "ABCD", "create")).toBe(
      "wss://david-smash.leaders-game.workers.dev/ws/room/ABCD?intent=create",
    );
    expect(roomSocketUrl("http://localhost:8787", "QRST", "join")).toBe("ws://localhost:8787/ws/room/QRST?intent=join");
  });
});

describe("the signalling client", () => {
  it("holds messages until the socket opens, then sends them in order", () => {
    const { signalling, socket } = client();
    signalling.send({ t: "lobby", payload: { kind: "away", away: true } });
    signalling.send({ t: "lobby", payload: { kind: "away", away: false } });
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent.map((s) => JSON.parse(s).payload.away)).toEqual([true, false]);
    signalling.send({ t: "signal", payload: { kind: "offer", sdp: "v=0" } });
    expect(socket.sent).toHaveLength(3);
  });

  it("emits what the room says, and ignores what it cannot read", () => {
    const { socket, events } = client();
    socket.open();
    socket.receive({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    socket.receive("{not json");
    socket.receive({ t: "mystery" });
    expect(events).toEqual([{ t: "welcome", self: { id: "h1", role: "host" }, peer: null }]);
  });

  it("reports how the room closed, so a full room can be told apart from a dead Worker", () => {
    const { socket, events } = client();
    socket.drop(4001, "full");
    expect(events).toEqual([{ t: "closed", code: 4001, reason: "full" }]);
  });

  it("closes politely and goes quiet", () => {
    const { signalling, socket, events } = client();
    socket.open();
    signalling.close();
    expect(socket.closedWith).toEqual([1000, "leaving"]);
    socket.receive({ t: "peer-left", peerId: "g1" });
    signalling.send({ t: "lobby", payload: { kind: "away", away: true } });
    expect(events).toEqual([]);
    expect(socket.sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/net/signalling.test.ts`
Expected: FAIL — `Failed to resolve import "./signalling"`.

- [ ] **Step 3: Implement** — `src/net/signalling.ts`:

```ts
/**
 * The browser's end of a room socket: `/ws/room/<CODE>?intent=create|join`.
 *
 * It carries the handshake and the lobby, never a game input. Messages sent
 * before the socket opens are queued rather than dropped, because the lobby
 * fires its first message the moment it learns its role. The socket's close
 * code is surfaced as an event: 4001–4008 are the room refusing (full, taken,
 * not-found…), 1006 before a welcome is "there is no Worker here".
 */

import { createEmitter, type Unsubscribe } from "./transport";
import { parseServerMessage, type ClientMessage, type RoomIntent, type ServerMessage } from "./signalProtocol";

/** The part of a WebSocket this client touches; tests supply a fake. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SignallingEvent = ServerMessage | { readonly t: "closed"; readonly code: number; readonly reason: string };

export interface SignallingClient {
  readonly url: string;
  send(message: ClientMessage): void;
  on(cb: (event: SignallingEvent) => void): Unsubscribe;
  /** Idempotent. Closes with 1000 and emits nothing further. */
  close(): void;
}

export interface SignallingOptions {
  readonly roomCode: string;
  readonly intent: RoomIntent;
  /** Defaults to `window.location.origin`. */
  readonly origin?: string;
  readonly createSocket?: (url: string) => WebSocketLike;
}

const OPEN = 1;

export function roomSocketUrl(origin: string, roomCode: string, intent: RoomIntent): string {
  const url = new URL(origin);
  const scheme = url.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${url.host}/ws/room/${encodeURIComponent(roomCode)}?intent=${intent}`;
}

/** One cast at the boundary, as in adapters/webrtc.ts: DOM handler types are wider than the slice used here. */
const browserSocket = (url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike;

export function createSignallingClient(options: SignallingOptions): SignallingClient {
  const url = roomSocketUrl(options.origin ?? window.location.origin, options.roomCode, options.intent);
  const socket = (options.createSocket ?? browserSocket)(url);
  const events = createEmitter<[SignallingEvent]>();
  const queue: string[] = [];
  let closed = false;

  socket.onopen = () => {
    for (const raw of queue.splice(0)) socket.send(raw);
  };
  socket.onmessage = (event) => {
    if (closed || typeof event.data !== "string") return;
    let value: unknown;
    try {
      value = JSON.parse(event.data);
    } catch {
      return;
    }
    const message = parseServerMessage(value);
    if (message) events.emit(message);
  };
  socket.onclose = (event) => {
    if (closed) return;
    closed = true;
    events.emit({ t: "closed", code: event.code, reason: event.reason });
    events.clear();
  };
  socket.onerror = () => {
    // A close event always follows an error, and it carries the code.
  };

  return {
    url,
    send(message) {
      if (closed) return;
      const raw = JSON.stringify(message);
      if (socket.readyState === OPEN) socket.send(raw);
      else queue.push(raw);
    },
    on: (cb) => events.add(cb),
    close() {
      if (closed) return;
      closed = true;
      events.clear();
      queue.length = 0;
      try {
        socket.close(1000, "leaving");
      } catch {
        /* already closing */
      }
    },
  };
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/net/signalling.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/net/signalling.ts super-smash/src/net/signalling.test.ts
git commit -m "super-smash: a WebSocket client for /ws/room/:code that queues until open and reports close codes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The Durable-Object-signalled WebRTC transport (`src/net/adapters/doSignal.ts`)

**Files:**
- Create: `super-smash/src/net/adapters/doSignal.ts`, `super-smash/src/net/adapters/doSignal.test.ts`

**Interfaces:**
- Consumes: `Transport`, `createEmitter` (`src/net/transport.ts:22-43,62`); `INPUT_CHANNEL_LABEL`, `DEFAULT_UNRELIABLE_CHANNEL_ID` (Task 3); `SignallingClient`, `SignallingEvent` (Task 9); `Role`, `WireIceCandidate` (Task 4).
- Produces:
```ts
export type DoSignalStatus = "waiting" | "negotiating" | "open" | "closed" | "failed";
export interface DataChannelLike { readonly readyState: string; binaryType: string; onopen: (() => void) | null; onclose: (() => void) | null; onerror: (() => void) | null; onmessage: ((event: { readonly data: unknown }) => void) | null; send(data: Uint8Array<ArrayBuffer>): void; close(): void }
export interface IceCandidateJson { readonly candidate?: string; readonly sdpMid?: string | null; readonly sdpMLineIndex?: number | null; readonly usernameFragment?: string | null }
export interface SessionDescriptionLike { readonly type: "offer" | "answer"; readonly sdp: string }
export interface DataChannelInitLike { readonly negotiated: boolean; readonly id: number; readonly ordered: boolean; readonly maxRetransmits: number }
export interface PeerConnectionLike { readonly connectionState: string; onicecandidate: ((event: { readonly candidate: { toJSON(): IceCandidateJson } | null }) => void) | null; onconnectionstatechange: (() => void) | null; createDataChannel(label: string, init: DataChannelInitLike): DataChannelLike; createOffer(): Promise<{ readonly sdp?: string }>; createAnswer(): Promise<{ readonly sdp?: string }>; setLocalDescription(d: SessionDescriptionLike): Promise<void>; setRemoteDescription(d: SessionDescriptionLike): Promise<void>; addIceCandidate(c: WireIceCandidate): Promise<void>; close(): void }
export interface PeerConfig { readonly iceServers: RTCIceServer[]; readonly iceTransportPolicy: "all" | "relay" }
export interface DoSignalOptions { readonly signalling: SignallingClient; readonly iceServers: RTCIceServer[]; readonly forceRelay?: boolean; readonly createPeerConnection?: (config: PeerConfig) => PeerConnectionLike; readonly onStatus?: (status: DoSignalStatus) => void }
export interface DoSignalTransport extends Transport { readonly status: DoSignalStatus; readonly role: Role | null }
export function createDoSignalTransport(options: DoSignalOptions): DoSignalTransport;
```

- [ ] **Step 1: Write the failing test** — `src/net/adapters/doSignal.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DEFAULT_UNRELIABLE_CHANNEL_ID, INPUT_CHANNEL_LABEL } from "../channel";
import type { SignallingClient, SignallingEvent } from "../signalling";
import type { ClientMessage, WireIceCandidate } from "../signalProtocol";
import { createEmitter } from "../transport";
import {
  createDoSignalTransport,
  type DataChannelInitLike,
  type DataChannelLike,
  type DoSignalStatus,
  type PeerConfig,
  type PeerConnectionLike,
  type SessionDescriptionLike,
} from "./doSignal";

/* --------------------------------------------------------------- fakes -- */

class FakeChannel implements DataChannelLike {
  readyState = "connecting";
  binaryType = "blob";
  onopen: DataChannelLike["onopen"] = null;
  onclose: DataChannelLike["onclose"] = null;
  onerror: DataChannelLike["onerror"] = null;
  onmessage: DataChannelLike["onmessage"] = null;
  readonly sent: Uint8Array[] = [];
  closed = false;

  constructor(readonly label: string, readonly init: DataChannelInitLike) {}

  send(data: Uint8Array<ArrayBuffer>): void {
    if (this.readyState !== "open") throw new Error("not open");
    this.sent.push(new Uint8Array(data));
  }
  close(): void {
    this.closed = true;
    this.readyState = "closed";
  }
  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }
  remoteClose(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

class FakePeer implements PeerConnectionLike {
  connectionState = "new";
  onicecandidate: PeerConnectionLike["onicecandidate"] = null;
  onconnectionstatechange: PeerConnectionLike["onconnectionstatechange"] = null;
  readonly channels: FakeChannel[] = [];
  readonly added: WireIceCandidate[] = [];
  local: SessionDescriptionLike | null = null;
  remote: SessionDescriptionLike | null = null;
  closed = false;

  constructor(readonly config: PeerConfig) {}

  createDataChannel(label: string, init: DataChannelInitLike): FakeChannel {
    const channel = new FakeChannel(label, init);
    this.channels.push(channel);
    return channel;
  }
  async createOffer() {
    return { sdp: "offer-sdp" };
  }
  async createAnswer() {
    return { sdp: "answer-sdp" };
  }
  async setLocalDescription(d: SessionDescriptionLike) {
    this.local = d;
  }
  async setRemoteDescription(d: SessionDescriptionLike) {
    this.remote = d;
  }
  async addIceCandidate(c: WireIceCandidate) {
    this.added.push(c);
  }
  close(): void {
    this.closed = true;
  }
  emitCandidate(candidate: string): void {
    this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate, sdpMid: "0", sdpMLineIndex: 0 }) } });
  }
  fail(): void {
    this.connectionState = "failed";
    this.onconnectionstatechange?.();
  }
}

class FakeSignalling implements SignallingClient {
  readonly url = "ws://test/ws/room/ABCD?intent=create";
  readonly sent: ClientMessage[] = [];
  private readonly events = createEmitter<[SignallingEvent]>();
  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  on(cb: (event: SignallingEvent) => void) {
    return this.events.add(cb);
  }
  close(): void {}
  deliver(event: SignallingEvent): void {
    this.events.emit(event);
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CANDIDATE: WireIceCandidate = { candidate: "candidate:1 1 udp 1 10.0.0.2 5000 typ host", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: null };

function setup(forceRelay = false) {
  const signalling = new FakeSignalling();
  const peers: FakePeer[] = [];
  const statuses: DoSignalStatus[] = [];
  const transport = createDoSignalTransport({
    signalling,
    iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
    forceRelay,
    createPeerConnection: (config) => {
      const peer = new FakePeer(config);
      peers.push(peer);
      return peer;
    },
    onStatus: (status) => statuses.push(status),
  });
  const joins: string[] = [];
  const leaves: string[] = [];
  const received: [number[], string][] = [];
  transport.onPeerJoin((id) => joins.push(id));
  transport.onPeerLeave((id) => leaves.push(id));
  transport.onMessage((bytes, id) => received.push([[...bytes], id]));
  return { signalling, peers, statuses, transport, joins, leaves, received };
}

async function linkedHost() {
  const t = setup();
  t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
  t.signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
  await settle();
  t.signalling.deliver({ t: "signal", from: "g1", payload: { kind: "answer", sdp: "answer-sdp" } });
  await settle();
  t.peers[0].channels[0].open();
  return t;
}

/* --------------------------------------------------------------- tests -- */

describe("the host", () => {
  it("offers as soon as a guest is in the room, on the negotiated unreliable channel", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    expect(t.peers).toHaveLength(0);
    t.signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
    await settle();

    expect(t.peers).toHaveLength(1);
    expect(t.peers[0].config).toEqual({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], iceTransportPolicy: "all" });
    expect(t.peers[0].channels[0].label).toBe(INPUT_CHANNEL_LABEL);
    expect(t.peers[0].channels[0].init).toEqual({ negotiated: true, id: DEFAULT_UNRELIABLE_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
    expect(t.peers[0].local).toEqual({ type: "offer", sdp: "offer-sdp" });
    expect(t.signalling.sent).toContainEqual({ t: "signal", payload: { kind: "offer", sdp: "offer-sdp" } });
    expect(t.transport.selfId).toBe("h1");
    expect(t.transport.role).toBe("host");
    expect(t.statuses).toEqual(["negotiating"]);
  });

  it("forces the TURN relay when asked to", async () => {
    const t = setup(true);
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    await settle();
    expect(t.peers[0].config.iceTransportPolicy).toBe("relay");
  });

  it("relays its own ICE candidates, but not the end-of-candidates marker", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    await settle();
    t.peers[0].emitCandidate(CANDIDATE.candidate);
    t.peers[0].emitCandidate("");
    const ice = t.signalling.sent.filter((m) => m.t === "signal" && m.payload.kind === "ice");
    expect(ice).toEqual([{ t: "signal", payload: { kind: "ice", candidate: CANDIDATE } }]);
  });
});

describe("the guest", () => {
  it("answers the host's offer, holding early candidates until it can use them", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "offer-sdp" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "ice", candidate: CANDIDATE } });
    await settle();

    expect(t.peers).toHaveLength(1);
    expect(t.peers[0].remote).toEqual({ type: "offer", sdp: "offer-sdp" });
    expect(t.peers[0].added).toEqual([CANDIDATE]);
    expect(t.signalling.sent).toContainEqual({ t: "signal", payload: { kind: "answer", sdp: "answer-sdp" } });
  });

  it("ignores candidates from anyone but the peer it is negotiating with", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    t.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "offer-sdp" } });
    await settle();
    t.signalling.deliver({ t: "signal", from: "intruder", payload: { kind: "ice", candidate: CANDIDATE } });
    await settle();
    expect(t.peers[0].added).toEqual([]);
  });
});

describe("a linked match", () => {
  it("announces the peer once the channel opens, and carries bytes both ways", async () => {
    const t = await linkedHost();
    expect(t.joins).toEqual(["g1"]);
    expect(t.transport.status).toBe("open");

    t.transport.send(new Uint8Array([1, 2, 3]));
    expect(t.peers[0].channels[0].sent).toEqual([new Uint8Array([1, 2, 3])]);

    t.peers[0].channels[0].onmessage?.({ data: new Uint8Array([9, 8]).buffer });
    expect(t.received).toEqual([[[9, 8], "g1"]]);
  });

  it("sends nothing, and does not throw, before the channel is open", async () => {
    const t = setup();
    expect(() => t.transport.send(new Uint8Array([1]))).not.toThrow();
  });

  it("reports the peer gone when the channel closes", async () => {
    const t = await linkedHost();
    t.peers[0].channels[0].remoteClose();
    expect(t.leaves).toEqual(["g1"]);
    expect(t.transport.status).toBe("waiting");
  });

  it("keeps playing when the room's sockets drop mid-match (a Worker deploy restarts the Durable Object)", async () => {
    const t = await linkedHost();
    t.signalling.deliver({ t: "peer-left", peerId: "g1" });
    t.signalling.deliver({ t: "closed", code: 1006, reason: "" });
    expect(t.leaves).toEqual([]);
    expect(t.transport.status).toBe("open");
    t.transport.send(new Uint8Array([7]));
    expect(t.peers[0].channels[0].sent).toEqual([new Uint8Array([7])]);
  });

  it("treats a failed ICE connection as a lost peer", async () => {
    const t = await linkedHost();
    t.peers[0].fail();
    expect(t.transport.status).toBe("failed");
    expect(t.leaves).toEqual(["g1"]);
  });

  it("sends the host back to waiting if the guest leaves before the channel opens", async () => {
    const t = setup();
    t.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    t.signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
    await settle();
    t.signalling.deliver({ t: "peer-left", peerId: "g1" });
    expect(t.peers[0].closed).toBe(true);
    expect(t.transport.status).toBe("waiting");
    expect(t.leaves).toEqual([]);
  });

  it("releases everything on close() and stays quiet afterwards", async () => {
    const t = await linkedHost();
    const channel = t.peers[0].channels[0];
    t.transport.close();
    expect(t.peers[0].closed).toBe(true);
    expect(channel.closed).toBe(true);
    expect(t.transport.status).toBe("closed");
    channel.onmessage?.({ data: new Uint8Array([1]).buffer });
    expect(t.received).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/net/adapters/doSignal.test.ts`
Expected: FAIL — `Failed to resolve import "./doSignal"`.

- [ ] **Step 3: Implement** — `src/net/adapters/doSignal.ts`:

```ts
/**
 * WebRTC, introduced through the room's Durable Object — the adapter online
 * play uses.
 *
 * Same contract as the Trystero adapter (`webrtc.ts`), different matchmaker:
 * instead of public Nostr relays, the two browsers meet in a room on our own
 * Worker, which relays one offer, one answer and their ICE candidates and then
 * has nothing more to do. Game traffic never touches it.
 *
 * The host offers; the guest answers. Roles come from the room, so there is
 * no glare to resolve. There is exactly one data channel, the input channel —
 * `negotiated: true` on stream 42, `ordered: false, maxRetransmits: 0` —
 * created by both sides before the offer, so it is part of the first SDP and
 * opens with the connection. Nothing here needs a reliable channel: the lobby
 * goes over the room socket, and inputs are redundant by design (packet.ts).
 *
 * The data channel is the authority on whether the peer is there. The room
 * socket is not: every Worker deploy restarts every Durable Object and drops
 * its sockets (Cloudflare's WebSocket docs say so), and a match in progress
 * must shrug that off. So `peer-left` from the room only matters before the
 * channel opens.
 */

import { DEFAULT_UNRELIABLE_CHANNEL_ID, INPUT_CHANNEL_LABEL } from "../channel";
import type { SignallingClient } from "../signalling";
import type { Role, WireIceCandidate } from "../signalProtocol";
import { createEmitter, type Transport } from "../transport";

export type DoSignalStatus = "waiting" | "negotiating" | "open" | "closed" | "failed";

/* -------------------------------------------- the WebRTC slice, structurally -- */

export interface DataChannelLike {
  readonly readyState: string;
  binaryType: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  send(data: Uint8Array<ArrayBuffer>): void;
  close(): void;
}

export interface IceCandidateJson {
  readonly candidate?: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
  readonly usernameFragment?: string | null;
}

export interface SessionDescriptionLike {
  readonly type: "offer" | "answer";
  readonly sdp: string;
}

export interface DataChannelInitLike {
  readonly negotiated: boolean;
  readonly id: number;
  readonly ordered: boolean;
  readonly maxRetransmits: number;
}

export interface PeerConnectionLike {
  readonly connectionState: string;
  onicecandidate: ((event: { readonly candidate: { toJSON(): IceCandidateJson } | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  createDataChannel(label: string, init: DataChannelInitLike): DataChannelLike;
  createOffer(): Promise<{ readonly sdp?: string }>;
  createAnswer(): Promise<{ readonly sdp?: string }>;
  setLocalDescription(description: SessionDescriptionLike): Promise<void>;
  setRemoteDescription(description: SessionDescriptionLike): Promise<void>;
  addIceCandidate(candidate: WireIceCandidate): Promise<void>;
  close(): void;
}

export interface PeerConfig {
  readonly iceServers: RTCIceServer[];
  /** "relay" forces TURN — the public e2e uses it to prove TURN works. */
  readonly iceTransportPolicy: "all" | "relay";
}

export interface DoSignalOptions {
  readonly signalling: SignallingClient;
  readonly iceServers: RTCIceServer[];
  readonly forceRelay?: boolean;
  /** Injected in tests; jsdom has no WebRTC. */
  readonly createPeerConnection?: (config: PeerConfig) => PeerConnectionLike;
  readonly onStatus?: (status: DoSignalStatus) => void;
}

export interface DoSignalTransport extends Transport {
  readonly status: DoSignalStatus;
  /** Known once the room's welcome arrives. */
  readonly role: Role | null;
}

/** One cast at the boundary, for the reason webrtc.ts gives for `RoomLike`. */
const browserPeerConnection = (config: PeerConfig): PeerConnectionLike =>
  new RTCPeerConnection(config) as unknown as PeerConnectionLike;

/* ----------------------------------------------------------------- adapter -- */

export function createDoSignalTransport(options: DoSignalOptions): DoSignalTransport {
  const createPeer = options.createPeerConnection ?? browserPeerConnection;
  const messages = createEmitter<[Uint8Array, string]>();
  const joins = createEmitter<[string]>();
  const leaves = createEmitter<[string]>();

  let selfId = "pending";
  let role: Role | null = null;
  let status: DoSignalStatus = "waiting";
  let closed = false;

  let pc: PeerConnectionLike | null = null;
  let channel: DataChannelLike | null = null;
  let remoteId: string | null = null;
  let announced = false;
  let remoteDescriptionSet = false;
  const pendingIce: WireIceCandidate[] = [];

  function setStatus(next: DoSignalStatus): void {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  }

  function teardown(): void {
    const ch = channel;
    const conn = pc;
    channel = null;
    pc = null;
    remoteId = null;
    announced = false;
    remoteDescriptionSet = false;
    pendingIce.length = 0;
    if (ch) {
      ch.onopen = null;
      ch.onclose = null;
      ch.onerror = null;
      ch.onmessage = null;
      try {
        ch.close();
      } catch {
        /* already gone */
      }
    }
    if (conn) {
      conn.onicecandidate = null;
      conn.onconnectionstatechange = null;
      try {
        conn.close();
      } catch {
        /* already gone */
      }
    }
  }

  /** The peer is gone for good: say so once, then wait for another. */
  function lose(next: DoSignalStatus): void {
    const id = remoteId;
    const wasAnnounced = announced;
    teardown();
    setStatus(next);
    if (wasAnnounced && id !== null) leaves.emit(id);
  }

  function openPeer(peerId: string): PeerConnectionLike {
    teardown();
    remoteId = peerId;
    const conn = createPeer({ iceServers: options.iceServers, iceTransportPolicy: options.forceRelay ? "relay" : "all" });
    const ch = conn.createDataChannel(INPUT_CHANNEL_LABEL, {
      negotiated: true,
      id: DEFAULT_UNRELIABLE_CHANNEL_ID,
      ordered: false,
      maxRetransmits: 0,
    });
    ch.binaryType = "arraybuffer";

    conn.onicecandidate = (event) => {
      if (conn !== pc || event.candidate === null) return;
      const candidate = toWire(event.candidate.toJSON());
      if (candidate) options.signalling.send({ t: "signal", payload: { kind: "ice", candidate } });
    };
    conn.onconnectionstatechange = () => {
      if (conn === pc && conn.connectionState === "failed") lose("failed");
    };
    ch.onopen = () => {
      if (ch !== channel || closed || remoteId === null) return;
      setStatus("open");
      if (!announced) {
        announced = true;
        joins.emit(remoteId);
      }
    };
    ch.onmessage = (event) => {
      if (ch !== channel || closed || remoteId === null) return;
      const bytes = asBytes(event.data);
      if (bytes) messages.emit(bytes, remoteId);
    };
    ch.onclose = () => {
      if (ch === channel) lose("waiting");
    };
    ch.onerror = () => {
      if (ch === channel) lose("waiting");
    };

    pc = conn;
    channel = ch;
    setStatus("negotiating");
    return conn;
  }

  async function offerTo(peerId: string): Promise<void> {
    const conn = openPeer(peerId);
    try {
      const offer = await conn.createOffer();
      if (conn !== pc) return;
      const sdp = offer.sdp ?? "";
      await conn.setLocalDescription({ type: "offer", sdp });
      if (conn !== pc) return;
      options.signalling.send({ t: "signal", payload: { kind: "offer", sdp } });
    } catch {
      if (conn === pc) lose("failed");
    }
  }

  async function answer(peerId: string, offerSdp: string): Promise<void> {
    const conn = openPeer(peerId);
    try {
      await conn.setRemoteDescription({ type: "offer", sdp: offerSdp });
      if (conn !== pc) return;
      remoteDescriptionSet = true;
      await flushIce(conn);
      const reply = await conn.createAnswer();
      if (conn !== pc) return;
      const sdp = reply.sdp ?? "";
      await conn.setLocalDescription({ type: "answer", sdp });
      if (conn !== pc) return;
      options.signalling.send({ t: "signal", payload: { kind: "answer", sdp } });
    } catch {
      if (conn === pc) lose("failed");
    }
  }

  async function acceptAnswer(sdp: string): Promise<void> {
    const conn = pc;
    if (conn === null) return;
    try {
      await conn.setRemoteDescription({ type: "answer", sdp });
      if (conn !== pc) return;
      remoteDescriptionSet = true;
      await flushIce(conn);
    } catch {
      if (conn === pc) lose("failed");
    }
  }

  async function addIce(candidate: WireIceCandidate): Promise<void> {
    const conn = pc;
    if (conn === null) return;
    // Candidates can outrun the description they belong to; adding one first
    // throws, so they wait.
    if (!remoteDescriptionSet) {
      pendingIce.push(candidate);
      return;
    }
    try {
      await conn.addIceCandidate(candidate);
    } catch {
      /* a stale or duplicate candidate is not a failure */
    }
  }

  async function flushIce(conn: PeerConnectionLike): Promise<void> {
    for (const candidate of pendingIce.splice(0)) {
      if (conn !== pc) return;
      try {
        await conn.addIceCandidate(candidate);
      } catch {
        /* as above */
      }
    }
  }

  const off = options.signalling.on((event) => {
    if (closed) return;
    switch (event.t) {
      case "welcome":
        selfId = event.self.id;
        role = event.self.role;
        if (role === "host" && event.peer) void offerTo(event.peer.id);
        break;
      case "peer-joined":
        if (role === "host") void offerTo(event.peer.id);
        break;
      case "signal": {
        const payload = event.payload;
        if (payload.kind === "offer") {
          if (role === "guest") void answer(event.from, payload.sdp);
        } else if (payload.kind === "answer") {
          if (role === "host" && event.from === remoteId) void acceptAnswer(payload.sdp);
        } else if (event.from === remoteId) {
          void addIce(payload.candidate);
        }
        break;
      }
      case "peer-left":
        // Only meaningful before the channel is up; afterwards the channel decides (see the header).
        if (event.peerId === remoteId && !announced) {
          teardown();
          setStatus("waiting");
        }
        break;
      default:
        // lobby, error and closed belong to the session, not the transport.
        break;
    }
  });

  return {
    get selfId() {
      return selfId;
    },
    get role() {
      return role;
    },
    get status() {
      return status;
    },
    send(bytes) {
      const ch = channel;
      if (closed || ch === null || ch.readyState !== "open") return;
      try {
        // Every packet comes from `encodePacket`, which allocates a plain ArrayBuffer.
        ch.send(bytes as Uint8Array<ArrayBuffer>);
      } catch {
        /* fire and forget: the next frame carries these inputs again */
      }
    },
    onMessage: (cb) => messages.add(cb),
    onPeerJoin: (cb) => joins.add(cb),
    onPeerLeave: (cb) => leaves.add(cb),
    close() {
      if (closed) return;
      closed = true;
      off();
      teardown();
      setStatus("closed");
      messages.clear();
      joins.clear();
      leaves.clear();
    },
  };
}

/* ----------------------------------------------------------------- helpers -- */

function toWire(json: IceCandidateJson): WireIceCandidate | null {
  // An empty candidate is the end-of-candidates marker; there is nothing to relay.
  if (!json.candidate) return null;
  return {
    candidate: json.candidate,
    sdpMid: json.sdpMid ?? null,
    sdpMLineIndex: json.sdpMLineIndex ?? null,
    usernameFragment: json.usernameFragment ?? null,
  };
}

function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/net/adapters/doSignal.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/net/adapters/doSignal.ts super-smash/src/net/adapters/doSignal.test.ts
git commit -m "super-smash: a WebRTC Transport signalled through the room's Durable Object" -m "Host offers, guest answers, early ICE candidates wait for their description. One negotiated unreliable unordered channel (id 42). The data channel decides whether the peer is there, so a deploy that restarts the room mid-match does not end it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Decide when a quiet opponent is gone (`src/net/online/watchdog.ts`)

**Files:**
- Create: `super-smash/src/net/online/watchdog.ts`, `super-smash/src/net/online/watchdog.test.ts`

**Interfaces (Produces):**
```ts
export const SILENCE_WAITING_MS = 1_000;
export const SILENCE_LOST_MS = 10_000;
export const AWAY_LOST_MS = 60_000;
export type LinkHealth = "ok" | "waiting" | "lost";
export class ConnectionWatchdog {
  constructor(now: number);
  readonly peerAway: boolean;            // getter
  heard(now: number): void;
  setPeerAway(away: boolean, now: number): void;
  check(now: number): LinkHealth;
}
```

- [ ] **Step 1: Write the failing test** — `src/net/online/watchdog.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { AWAY_LOST_MS, ConnectionWatchdog, SILENCE_LOST_MS, SILENCE_WAITING_MS } from "./watchdog";

describe("ConnectionWatchdog", () => {
  it("is ok while packets keep arriving", () => {
    const dog = new ConnectionWatchdog(0);
    dog.heard(500);
    expect(dog.check(900)).toBe("ok");
  });

  it("shows the player it is waiting after a second of silence", () => {
    const dog = new ConnectionWatchdog(0);
    expect(dog.check(SILENCE_WAITING_MS - 1)).toBe("ok");
    expect(dog.check(SILENCE_WAITING_MS)).toBe("waiting");
  });

  it("gives up after ten seconds of silence", () => {
    const dog = new ConnectionWatchdog(0);
    expect(dog.check(SILENCE_LOST_MS - 1)).toBe("waiting");
    expect(dog.check(SILENCE_LOST_MS)).toBe("lost");
  });

  it("gives a backgrounded opponent a minute, not ten seconds", () => {
    const dog = new ConnectionWatchdog(0);
    dog.setPeerAway(true, 1_000);
    expect(dog.peerAway).toBe(true);
    expect(dog.check(1_000 + 30_000)).toBe("waiting");
    expect(dog.check(1_000 + AWAY_LOST_MS - 1)).toBe("waiting");
    expect(dog.check(1_000 + AWAY_LOST_MS)).toBe("lost");
  });

  it("is ok again the moment they come back", () => {
    const dog = new ConnectionWatchdog(0);
    dog.setPeerAway(true, 0);
    dog.setPeerAway(false, 40_000);
    expect(dog.check(40_100)).toBe("ok");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/net/online/watchdog.test.ts`
Expected: FAIL — `Failed to resolve import "./watchdog"`.

- [ ] **Step 3: Implement** — `src/net/online/watchdog.ts`:

```ts
/**
 * When to stop waiting for the other player.
 *
 * A rollback session sends a packet every frame, stalled or not, so silence is
 * a real signal: a second of it is worth telling the player about, ten
 * seconds means the peer is gone. One case breaks that rule. A browser stops
 * `requestAnimationFrame` in a background tab, so an opponent who switches
 * tabs goes silent while still connected — and says so first, with a lobby
 * `away` message. They get a minute.
 *
 * Wall-clock only, and outside the simulation (SPEC §3): nothing here feeds
 * `step()`.
 */

export const SILENCE_WAITING_MS = 1_000;
export const SILENCE_LOST_MS = 10_000;
export const AWAY_LOST_MS = 60_000;

export type LinkHealth = "ok" | "waiting" | "lost";

export class ConnectionWatchdog {
  private lastHeard: number;
  private away = false;

  constructor(now: number) {
    this.lastHeard = now;
  }

  get peerAway(): boolean {
    return this.away;
  }

  heard(now: number): void {
    this.lastHeard = now;
  }

  /** Hearing "I am away" is hearing from them, so it also resets the clock. */
  setPeerAway(away: boolean, now: number): void {
    this.away = away;
    this.lastHeard = now;
  }

  check(now: number): LinkHealth {
    const silent = now - this.lastHeard;
    if (silent >= (this.away ? AWAY_LOST_MS : SILENCE_LOST_MS)) return "lost";
    return this.away || silent >= SILENCE_WAITING_MS ? "waiting" : "ok";
  }
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/net/online/watchdog.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/net/online/watchdog.ts super-smash/src/net/online/watchdog.test.ts
git commit -m "super-smash: a watchdog that waits 10 s for a silent peer and 60 s for one that switched tabs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Lobby messages and the host's start config

**Files:**
- Create: `super-smash/src/net/online/lobby.ts`, `super-smash/src/net/online/lobby.test.ts`, `super-smash/src/game/onlineConfig.ts`, `super-smash/src/game/onlineConfig.test.ts`

**Interfaces:**
- Consumes: `MatchRules` (`src/engine/types.ts:570`); `STAGE_FORMS`, `StageForm`, `MIN_STOCKS`, `MAX_STOCKS`, `RANDOM_FIGHTER`, `PlayerSlot` (`src/lib/matchConfig.ts:595-631`); `FIGHTERS`, `resolveFighterId`, `resolveMatchStage` (`src/game/bootstrap.ts:76,91,125`); `PlayerSlot as RunnerSlot` (`src/game/matchRunner.ts:60`).
- Produces:
```ts
// src/net/online/lobby.ts
export interface OnlineMatchConfig { readonly seed: number; readonly stageId: string; readonly stageForm: StageForm; readonly rules: MatchRules; readonly fighters: readonly [string, string]; readonly costumes: readonly [number, number] }
export type LobbyMessage =
  | { readonly kind: "pick"; readonly fighterId: string | null; readonly costume: number }
  | { readonly kind: "stage"; readonly stageId: string; readonly form: StageForm }
  | { readonly kind: "start"; readonly config: OnlineMatchConfig }
  | { readonly kind: "away"; readonly away: boolean };
export function parseLobbyMessage(payload: unknown): LobbyMessage | null;
// src/game/onlineConfig.ts
export interface StartConfigInput { readonly players: readonly PlayerSlot[]; readonly stageId: string; readonly stageForm: StageForm; readonly rules: MatchRules; readonly seed: number }
export function buildStartConfig(input: StartConfigInput): OnlineMatchConfig;
export function newMatchSeed(random?: () => number): number;
export function runnerSlotsFor(config: OnlineMatchConfig): RunnerSlot[];
```

- [ ] **Step 1: Write the failing tests** — `src/net/online/lobby.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseLobbyMessage, type OnlineMatchConfig } from "./lobby";

const CONFIG: OnlineMatchConfig = {
  seed: 1234,
  stageId: "battlefield",
  stageForm: "omega",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};

describe("lobby messages", () => {
  it("reads a pick, including clearing one", () => {
    expect(parseLobbyMessage({ kind: "pick", fighterId: "fox", costume: 2 })).toEqual({ kind: "pick", fighterId: "fox", costume: 2 });
    expect(parseLobbyMessage({ kind: "pick", fighterId: null, costume: 0 })).toEqual({ kind: "pick", fighterId: null, costume: 0 });
  });

  it("reads the host's stage", () => {
    expect(parseLobbyMessage({ kind: "stage", stageId: "smashville", form: "battlefield" })).toEqual({
      kind: "stage",
      stageId: "smashville",
      form: "battlefield",
    });
  });

  it("reads a start with its whole config, as it arrives off the wire", () => {
    expect(parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "start", config: CONFIG })))).toEqual({ kind: "start", config: CONFIG });
  });

  it("reads an away flag", () => {
    expect(parseLobbyMessage({ kind: "away", away: true })).toEqual({ kind: "away", away: true });
  });

  it("refuses anything a peer could use to break the other side", () => {
    const bad: unknown[] = [
      null,
      "pick",
      { kind: "pick", fighterId: "../etc", costume: 0 },
      { kind: "pick", fighterId: "fox", costume: 99 },
      { kind: "pick", fighterId: "fox", costume: 1.5 },
      { kind: "stage", stageId: "battlefield", form: "mirror" },
      { kind: "start", config: { ...CONFIG, fighters: ["mario"] } },
      { kind: "start", config: { ...CONFIG, rules: { ...CONFIG.rules, stocks: 0 } } },
      { kind: "start", config: { ...CONFIG, rules: { ...CONFIG.rules, mode: "coin" } } },
      { kind: "start", config: { ...CONFIG, seed: 1.5 } },
      { kind: "away", away: "yes" },
      { kind: "explode" },
    ];
    for (const payload of bad) expect(parseLobbyMessage(payload)).toBeNull();
  });
});
```

`src/game/onlineConfig.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import type { MatchRules } from "@/engine/types";
import { RANDOM_FIGHTER, RANDOM_STAGE, type PlayerSlot } from "@/lib/matchConfig";
import { parseLobbyMessage } from "@/net/online/lobby";
import { FIGHTERS, STAGES, bootstrapEngine, resolveMatchStage } from "./bootstrap";
import { buildStartConfig, newMatchSeed, runnerSlotsFor } from "./onlineConfig";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: true, oneOnOne: false };

function players(a: string | null, b: string | null): PlayerSlot[] {
  return [
    { port: 0, kind: "human", cpuLevel: 3, fighterId: a, costume: 0, scheme: "arrows" },
    { port: 1, kind: "human", cpuLevel: 3, fighterId: b, costume: 1, scheme: "arrows" },
  ];
}

beforeAll(() => {
  bootstrapEngine();
});

describe("the host's start config", () => {
  it("resolves Random before it leaves the host, so both peers load the same match", () => {
    const config = buildStartConfig({ players: players(RANDOM_FIGHTER, "fox"), stageId: RANDOM_STAGE, stageForm: "omega", rules: RULES, seed: 1234 });
    expect(FIGHTERS.map((f) => f.id)).toContain(config.fighters[0]);
    expect(config.fighters[1]).toBe("fox");
    expect(STAGES.map((s) => s.id)).toContain(config.stageId);
    expect(config.stageForm).toBe("omega");
    expect(config.costumes).toEqual([0, 1]);
  });

  it("gives both peers the same stage, whatever seed each would have used", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: RANDOM_STAGE, stageForm: "battlefield", rules: RULES, seed: 99 });
    expect(resolveMatchStage(config.stageId, config.stageForm, config.seed).id).toBe(
      resolveMatchStage(config.stageId, config.stageForm, 7).id,
    );
  });

  it("treats a fighter id it does not know as Random rather than crashing both games", () => {
    const config = buildStartConfig({ players: players("not-a-fighter", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect(FIGHTERS.map((f) => f.id)).toContain(config.fighters[0]);
  });

  it("always plays the 1v1 rules online", () => {
    expect(buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 }).rules.oneOnOne).toBe(true);
  });

  it("refuses anything but two players", () => {
    expect(() =>
      buildStartConfig({ players: players("mario", "fox").slice(0, 1), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 }),
    ).toThrow(/two players/);
  });

  it("survives its own wire format", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect(parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "start", config })))).toEqual({ kind: "start", config });
  });

  it("makes a positive 31-bit seed", () => {
    expect(newMatchSeed(() => 0.5)).toBe(Math.floor(0.5 * 0x7fff_ffff));
    expect(newMatchSeed(() => 0)).toBe(0);
  });

  it("turns a config into the runner's two human slots", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect(runnerSlotsFor(config)).toEqual([
      { selection: { defId: "mario", costume: 0 }, cpuLevel: null, label: "P1" },
      { selection: { defId: "fox", costume: 1 }, cpuLevel: null, label: "P2" },
    ]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/net/online/lobby.test.ts src/game/onlineConfig.test.ts`
Expected: FAIL — `Failed to resolve import "./lobby"` / `"./onlineConfig"`.

- [ ] **Step 3: Implement** — `src/net/online/lobby.ts`:

```ts
/**
 * What the two players say to each other before a match, through the room.
 *
 * The host is authoritative: it picks the stage, resolves every Random, draws
 * the seed and sends one `start` carrying the whole match. Both peers then
 * build the identical initial state from that config — which is what rollback
 * requires, since a single differing byte at frame 0 is a desync forever.
 *
 * Validated hard, because a `start` that names a fighter this build does not
 * have would throw inside `createInitialState` on the other machine.
 */

import type { MatchRules } from "@/engine/types";
import { MAX_STOCKS, MIN_STOCKS, STAGE_FORMS, type StageForm } from "@/lib/matchConfig";

export interface OnlineMatchConfig {
  readonly seed: number;
  /** A concrete base stage id; Random is resolved by the host. */
  readonly stageId: string;
  readonly stageForm: StageForm;
  readonly rules: MatchRules;
  /** Concrete fighter ids for ports 0 and 1. */
  readonly fighters: readonly [string, string];
  readonly costumes: readonly [number, number];
}

export type LobbyMessage =
  | { readonly kind: "pick"; readonly fighterId: string | null; readonly costume: number }
  | { readonly kind: "stage"; readonly stageId: string; readonly form: StageForm }
  | { readonly kind: "start"; readonly config: OnlineMatchConfig }
  | { readonly kind: "away"; readonly away: boolean };

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_COSTUME = 15;

export function parseLobbyMessage(payload: unknown): LobbyMessage | null {
  if (!isRecord(payload)) return null;
  switch (payload.kind) {
    case "pick": {
      const raw = payload.fighterId;
      const fighterId = raw === null ? null : isId(raw) ? raw : undefined;
      const costume = payload.costume;
      if (fighterId === undefined || !isCostume(costume)) return null;
      return { kind: "pick", fighterId, costume };
    }
    case "stage": {
      const stageId = payload.stageId;
      const form = payload.form;
      return isId(stageId) && isStageForm(form) ? { kind: "stage", stageId, form } : null;
    }
    case "start": {
      const config = parseConfig(payload.config);
      return config ? { kind: "start", config } : null;
    }
    case "away": {
      const away = payload.away;
      return typeof away === "boolean" ? { kind: "away", away } : null;
    }
    default:
      return null;
  }
}

function parseConfig(value: unknown): OnlineMatchConfig | null {
  if (!isRecord(value)) return null;
  const { seed, stageId, stageForm, rules, fighters, costumes } = value;
  if (typeof seed !== "number" || !Number.isInteger(seed)) return null;
  if (!isId(stageId) || !isStageForm(stageForm)) return null;
  const parsedRules = parseRules(rules);
  if (!parsedRules) return null;
  if (!Array.isArray(fighters) || fighters.length !== 2) return null;
  const [f0, f1] = fighters as unknown[];
  if (!isId(f0) || !isId(f1)) return null;
  if (!Array.isArray(costumes) || costumes.length !== 2) return null;
  const [c0, c1] = costumes as unknown[];
  if (!isCostume(c0) || !isCostume(c1)) return null;
  return { seed, stageId, stageForm, rules: parsedRules, fighters: [f0, f1], costumes: [c0, c1] };
}

function parseRules(value: unknown): MatchRules | null {
  if (!isRecord(value)) return null;
  const { mode, stocks, timeLimit, smashBall, oneOnOne } = value;
  if (mode !== "stock" && mode !== "time") return null;
  if (typeof stocks !== "number" || !Number.isInteger(stocks) || stocks < MIN_STOCKS || stocks > MAX_STOCKS) return null;
  if (typeof timeLimit !== "number" || !Number.isInteger(timeLimit) || timeLimit < 0) return null;
  if (typeof smashBall !== "boolean" || typeof oneOnOne !== "boolean") return null;
  return { mode, stocks, timeLimit, smashBall, oneOnOne };
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function isCostume(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COSTUME;
}

function isStageForm(value: unknown): value is StageForm {
  return typeof value === "string" && (STAGE_FORMS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

`src/game/onlineConfig.ts`:

```ts
/**
 * The host's half of starting an online match.
 *
 * Everything that could differ between two machines is decided here, once,
 * and shipped: the seed, which roster entry Random became, which stage. The
 * guest never resolves anything itself — `resolveMatchStage` on a concrete id
 * ignores the seed, so both peers land on the same `StageDef`.
 */

import type { MatchRules } from "@/engine/types";
import { RANDOM_FIGHTER, type PlayerSlot, type StageForm } from "@/lib/matchConfig";
import type { OnlineMatchConfig } from "@/net/online/lobby";
import { FIGHTERS, resolveFighterId, resolveMatchStage } from "./bootstrap";
import type { PlayerSlot as RunnerSlot } from "./matchRunner";

export interface StartConfigInput {
  readonly players: readonly PlayerSlot[];
  readonly stageId: string;
  readonly stageForm: StageForm;
  readonly rules: MatchRules;
  readonly seed: number;
}

export function buildStartConfig(input: StartConfigInput): OnlineMatchConfig {
  if (input.players.length !== 2) throw new Error(`An online match is two players, not ${input.players.length}`);
  const [p0, p1] = input.players;
  const seed = input.seed | 0;
  return {
    seed,
    // "normal" leaves the base id untouched; the form travels separately.
    stageId: resolveMatchStage(input.stageId, "normal", seed).id,
    stageForm: input.stageForm,
    rules: { ...input.rules, oneOnOne: true },
    fighters: [resolveFighterId(known(p0.fighterId), seed, 0), resolveFighterId(known(p1.fighterId), seed, 1)],
    costumes: [p0.costume, p1.costume],
  };
}

/** Outside the simulation, so `Math.random` is allowed; the result enters it only as data. */
export function newMatchSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0x7fff_ffff) | 0;
}

export function runnerSlotsFor(config: OnlineMatchConfig): RunnerSlot[] {
  return config.fighters.map((defId, port) => ({
    selection: { defId, costume: config.costumes[port] },
    cpuLevel: null,
    label: `P${port + 1}`,
  }));
}

/** A pick from the wire that names no fighter in this build plays as Random. */
function known(id: string | null): string {
  return id !== null && FIGHTERS.some((f) => f.id === id) ? id : RANDOM_FIGHTER;
}
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/net/online/lobby.test.ts src/game/onlineConfig.test.ts`
Expected: PASS (5 + 8 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/net/online/lobby.ts super-smash/src/net/online/lobby.test.ts super-smash/src/game/onlineConfig.ts super-smash/src/game/onlineConfig.test.ts
git commit -m "super-smash: lobby messages and a host-built start config both peers can trust" -m "pick/stage/start/away, validated hard. The host resolves Random fighters and stages and draws the seed once; the guest only reads." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: One online session: room socket + transport + lobby (`src/net/online/session.ts`)

**Files:**
- Create: `super-smash/src/net/online/session.ts`, `super-smash/src/net/online/session.test.ts`

**Interfaces:**
- Consumes: `createSignallingClient`, `SignallingClient` (Task 9); `fetchIceServers`, `toRtcIceServers` (Task 8); `IceResponse` (Task 4); `createDoSignalTransport`, `DoSignalStatus`, `DoSignalTransport`, `PeerConfig`, `PeerConnectionLike` (Task 10); `ROLE_PORT`, `roomErrorForCloseCode`, `Role`, `RoomError`, `RoomIntent` (Task 4); `parseLobbyMessage`, `LobbyMessage` (Task 12); `createEmitter`, `Emitter`, `Unsubscribe` (`src/net/transport.ts`).
- Produces:
```ts
export type SessionError = RoomError | "unreachable";
export type SessionEvent =
  | { readonly type: "joined"; readonly role: Role }
  | { readonly type: "peer"; readonly present: boolean }
  | { readonly type: "link"; readonly status: DoSignalStatus }
  | { readonly type: "lobby"; readonly message: LobbyMessage }
  | { readonly type: "error"; readonly reason: SessionError };
export interface OnlineSessionLike {
  readonly roomCode: string; readonly role: Role | null; readonly localPort: number | null; readonly turn: boolean;
  readonly transport: DoSignalTransport;
  on(cb: (event: SessionEvent) => void): Unsubscribe; sendLobby(message: LobbyMessage): void; close(): void;
}
export interface OpenSessionOptions {
  readonly forceRelay?: boolean;
  readonly openSignalling?: (roomCode: string, intent: RoomIntent) => SignallingClient;
  readonly fetchIce?: () => Promise<IceResponse>;
  readonly createPeerConnection?: (config: PeerConfig) => PeerConnectionLike;
}
export class OnlineSession implements OnlineSessionLike { static open(roomCode: string, intent: RoomIntent, options?: OpenSessionOptions): Promise<OnlineSession> }
export function getActiveSession(): OnlineSessionLike | null;
export function setActiveSession(next: OnlineSessionLike | null): void; // closes the previous one
```

- [ ] **Step 1: Write the failing test** — `src/net/online/session.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import type { DataChannelLike, PeerConnectionLike } from "../adapters/doSignal";
import { STUN_ONLY } from "../iceConfig";
import type { SignallingClient, SignallingEvent } from "../signalling";
import type { ClientMessage, RoomIntent } from "../signalProtocol";
import { createEmitter } from "../transport";
import { OnlineSession, getActiveSession, setActiveSession, type SessionEvent } from "./session";

class FakeSignalling implements SignallingClient {
  readonly url = "ws://test/ws/room/ABCD?intent=create";
  readonly sent: ClientMessage[] = [];
  closed = false;
  private readonly events = createEmitter<[SignallingEvent]>();
  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  on(cb: (event: SignallingEvent) => void) {
    return this.events.add(cb);
  }
  close(): void {
    this.closed = true;
  }
  deliver(event: SignallingEvent): void {
    this.events.emit(event);
  }
}

const inertChannel = (): DataChannelLike => ({
  readyState: "connecting",
  binaryType: "blob",
  onopen: null,
  onclose: null,
  onerror: null,
  onmessage: null,
  send() {},
  close() {},
});

const inertPeer = (): PeerConnectionLike => ({
  connectionState: "new",
  onicecandidate: null,
  onconnectionstatechange: null,
  createDataChannel: inertChannel,
  createOffer: async () => ({ sdp: "o" }),
  createAnswer: async () => ({ sdp: "a" }),
  setLocalDescription: async () => {},
  setRemoteDescription: async () => {},
  addIceCandidate: async () => {},
  close() {},
});

async function open(intent: RoomIntent = "create") {
  const order: string[] = [];
  const signalling = new FakeSignalling();
  const session = await OnlineSession.open("ABCD", intent, {
    fetchIce: async () => {
      order.push("ice");
      return STUN_ONLY;
    },
    openSignalling: (code, i) => {
      order.push(`socket ${code} ${i}`);
      return signalling;
    },
    createPeerConnection: inertPeer,
  });
  const events: SessionEvent[] = [];
  session.on((event) => events.push(event));
  return { session, signalling, events, order };
}

afterEach(() => setActiveSession(null));

describe("OnlineSession", () => {
  it("fetches ICE servers before it opens the room socket", async () => {
    const { order, session } = await open("join");
    expect(order).toEqual(["ice", "socket ABCD join"]);
    expect(session.turn).toBe(false);
    expect(session.roomCode).toBe("ABCD");
  });

  it("learns its role and port from the room", async () => {
    const host = await open();
    host.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    expect(host.events).toContainEqual({ type: "joined", role: "host" });
    expect(host.session.role).toBe("host");
    expect(host.session.localPort).toBe(0);

    const guest = await open("join");
    guest.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
    expect(guest.session.localPort).toBe(1);
    expect(guest.events).toContainEqual({ type: "peer", present: true });
  });

  it("reports the other player arriving and leaving", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
    signalling.deliver({ t: "peer-left", peerId: "g1" });
    expect(events.filter((e) => e.type === "peer")).toEqual([
      { type: "peer", present: true },
      { type: "peer", present: false },
    ]);
    expect(events).toContainEqual({ type: "link", status: "negotiating" });
  });

  it("passes on the lobby messages it understands and drops the rest", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 1 } });
    signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "explode" } });
    expect(events).toEqual([{ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 1 } }]);
  });

  it("says why the room refused it, once", async () => {
    const { signalling, events } = await open("join");
    signalling.deliver({ t: "error", reason: "full" });
    signalling.deliver({ t: "closed", code: 4001, reason: "full" });
    expect(events).toEqual([{ type: "error", reason: "full" }]);
  });

  it("calls a Worker that is not there unreachable", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "closed", code: 1006, reason: "" });
    expect(events).toEqual([{ type: "error", reason: "unreachable" }]);
  });

  it("a room restart after joining is not an error", async () => {
    const { signalling, events } = await open();
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: null });
    signalling.deliver({ t: "closed", code: 1006, reason: "" });
    expect(events.filter((e) => e.type === "error")).toEqual([]);
  });

  it("sends lobby messages through the room", async () => {
    const { session, signalling } = await open();
    session.sendLobby({ kind: "away", away: true });
    expect(signalling.sent.at(-1)).toEqual({ t: "lobby", payload: { kind: "away", away: true } });
  });

  it("close() closes the transport and the socket, and goes quiet", async () => {
    const { session, signalling, events } = await open();
    session.close();
    expect(signalling.closed).toBe(true);
    expect(session.transport.status).toBe("closed");
    signalling.deliver({ t: "peer-joined", peer: { id: "g1", role: "guest" } });
    expect(events).toEqual([]);
  });

  it("replacing the active session closes the old one", async () => {
    const first = await open();
    const second = await open();
    setActiveSession(first.session);
    setActiveSession(second.session);
    expect(first.signalling.closed).toBe(true);
    expect(getActiveSession()).toBe(second.session);
    setActiveSession(null);
    expect(second.signalling.closed).toBe(true);
    expect(getActiveSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/net/online/session.test.ts`
Expected: FAIL — `Failed to resolve import "./session"`.

- [ ] **Step 3: Implement** — `src/net/online/session.ts`:

```ts
/**
 * One online session: a room socket, the WebRTC transport it introduces, and
 * the lobby talk that rides the same socket.
 *
 * Opened from the lobby, kept alive across client-side navigation (stage →
 * fighters → play) as the active session, and closed on leaving. ICE servers
 * are fetched first so the transport exists before the room can say a word —
 * every signalling message then has somewhere to go.
 */

import { createDoSignalTransport, type DoSignalStatus, type DoSignalTransport, type PeerConfig, type PeerConnectionLike } from "../adapters/doSignal";
import type { IceResponse } from "../iceConfig";
import { fetchIceServers, toRtcIceServers } from "../iceServers";
import { createSignallingClient, type SignallingClient } from "../signalling";
import { ROLE_PORT, roomErrorForCloseCode, type Role, type RoomError, type RoomIntent } from "../signalProtocol";
import { createEmitter, type Emitter, type Unsubscribe } from "../transport";
import { parseLobbyMessage, type LobbyMessage } from "./lobby";

export type SessionError = RoomError | "unreachable";

export type SessionEvent =
  | { readonly type: "joined"; readonly role: Role }
  | { readonly type: "peer"; readonly present: boolean }
  | { readonly type: "link"; readonly status: DoSignalStatus }
  | { readonly type: "lobby"; readonly message: LobbyMessage }
  | { readonly type: "error"; readonly reason: SessionError };

export interface OnlineSessionLike {
  readonly roomCode: string;
  readonly role: Role | null;
  readonly localPort: number | null;
  readonly turn: boolean;
  readonly transport: DoSignalTransport;
  on(cb: (event: SessionEvent) => void): Unsubscribe;
  sendLobby(message: LobbyMessage): void;
  close(): void;
}

export interface OpenSessionOptions {
  readonly forceRelay?: boolean;
  readonly openSignalling?: (roomCode: string, intent: RoomIntent) => SignallingClient;
  readonly fetchIce?: () => Promise<IceResponse>;
  readonly createPeerConnection?: (config: PeerConfig) => PeerConnectionLike;
}

export class OnlineSession implements OnlineSessionLike {
  static async open(roomCode: string, intent: RoomIntent, options: OpenSessionOptions = {}): Promise<OnlineSession> {
    const ice = await (options.fetchIce ?? (() => fetchIceServers()))();
    const openSignalling =
      options.openSignalling ?? ((code: string, i: RoomIntent) => createSignallingClient({ roomCode: code, intent: i }));
    const signalling = openSignalling(roomCode, intent);
    const events = createEmitter<[SessionEvent]>();
    const transport = createDoSignalTransport({
      signalling,
      iceServers: toRtcIceServers(ice),
      forceRelay: options.forceRelay,
      createPeerConnection: options.createPeerConnection,
      onStatus: (status) => events.emit({ type: "link", status }),
    });
    return new OnlineSession(roomCode, signalling, transport, ice.turn, events);
  }

  private welcomed = false;
  private closed = false;
  private readonly off: Unsubscribe;

  private constructor(
    readonly roomCode: string,
    private readonly signalling: SignallingClient,
    readonly transport: DoSignalTransport,
    readonly turn: boolean,
    private readonly events: Emitter<[SessionEvent]>,
  ) {
    // Subscribed after the transport, so the transport has its role before
    // anybody hears "joined".
    this.off = signalling.on((event) => {
      switch (event.t) {
        case "welcome":
          this.welcomed = true;
          this.events.emit({ type: "joined", role: event.self.role });
          if (event.peer) this.events.emit({ type: "peer", present: true });
          break;
        case "peer-joined":
          this.events.emit({ type: "peer", present: true });
          break;
        case "peer-left":
          this.events.emit({ type: "peer", present: false });
          break;
        case "lobby": {
          const message = parseLobbyMessage(event.payload);
          if (message) this.events.emit({ type: "lobby", message });
          break;
        }
        case "error":
          this.events.emit({ type: "error", reason: event.reason });
          break;
        case "closed":
          // A refusal already arrived as an `error`. After a welcome, a drop is
          // a Worker deploy restarting the room — the match is peer to peer
          // and carries on (spec review focus). Before one, nobody answered.
          if (this.closed || roomErrorForCloseCode(event.code) !== null || this.welcomed) break;
          this.events.emit({ type: "error", reason: "unreachable" });
          break;
        default:
          break;
      }
    });
  }

  get role(): Role | null {
    return this.transport.role;
  }

  get localPort(): number | null {
    const role = this.role;
    return role === null ? null : ROLE_PORT[role];
  }

  on(cb: (event: SessionEvent) => void): Unsubscribe {
    return this.events.add(cb);
  }

  sendLobby(message: LobbyMessage): void {
    if (this.closed) return;
    this.signalling.send({ t: "lobby", payload: message });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.off();
    // Listeners first: closing the transport reports a final "closed" link
    // status, and nobody who called close() wants to hear it.
    this.events.clear();
    this.transport.close();
    this.signalling.close();
  }
}

/* ------------------------------------------------------- the active session -- */

/**
 * The one live session, held outside React so it survives `router.push`
 * between /online, /stage, /fighters and /play. A full page load drops it,
 * which the play page treats as "no online match".
 */
let active: OnlineSessionLike | null = null;

export function getActiveSession(): OnlineSessionLike | null {
  return active;
}

export function setActiveSession(next: OnlineSessionLike | null): void {
  if (active && active !== next) active.close();
  active = next;
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/net/online/session.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/net/online/session.ts super-smash/src/net/online/session.test.ts
git commit -m "super-smash: an online session that owns the room socket, the transport and the lobby" -m "Fetches ICE first, then opens the room; maps welcome/peer/lobby/error into session events; a drop after joining is a deploy restart, not an error. One active session survives client-side navigation." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Online UI state, and the match config's online mode

**Files:**
- Create: `super-smash/src/lib/onlineStore.ts`, `super-smash/src/lib/onlineStore.test.ts`
- Modify: `super-smash/src/lib/matchConfig.ts:661-672` (`MatchResult`), `:680-713` (state interface), `:751-891` (store: add two actions); `super-smash/src/lib/matchConfig.test.ts` (append)

**Interfaces:**
- Consumes: `OnlineSessionLike`, `SessionError`, `getActiveSession`, `setActiveSession` (Task 13); `LobbyMessage`, `OnlineMatchConfig` (Task 12); `Role` (Task 4); `useMatchConfig` (`src/lib/matchConfig.ts:751`).
- Produces (matchConfig): `MatchResult.kind: MatchOutcome["kind"] | "connectionLost"`; `MatchResult.online?: boolean`; actions `configureOnline(): void` (two human ports, scheme "arrows", no fighters), `leaveOnline(): void` (back to the default human + CPU).
- Produces (onlineStore):
```ts
export type OnlineStatus = "idle" | "connecting" | "waiting" | "linking" | "connected" | "error";
export type OnlineErrorReason = SessionError | "link-failed" | "peer-left";
export interface OnlineFields { status: OnlineStatus; roomCode: string | null; role: Role | null; error: string | null; errorReason: OnlineErrorReason | null; hostStage: { readonly stageId: string; readonly form: StageForm } | null; config: OnlineMatchConfig | null; remoteAway: boolean }
export const useOnlineStore: UseBoundStore<StoreApi<OnlineFields & { patch(next: Partial<OnlineFields>): void; reset(): void }>>;
export function roomErrorMessage(reason: OnlineErrorReason, roomCode: string): string;
export function bindSession(session: OnlineSessionLike): Unsubscribe;
export function sendLobby(message: LobbyMessage): void;
export function leaveOnline(): void;
```

- [ ] **Step 1: Write the failing tests** — append to `src/lib/matchConfig.test.ts`:

```ts
describe("online mode", () => {
  beforeEach(() => {
    useMatchConfig.getState().reset();
  });

  it("seats two humans on their own keyboards with empty panels", () => {
    useMatchConfig.getState().configureOnline();
    const { players, rules } = useMatchConfig.getState();
    expect(players.map((p) => [p.port, p.kind, p.scheme, p.fighterId])).toEqual([
      [0, "human", "arrows", null],
      [1, "human", "arrows", null],
    ]);
    expect(rules.oneOnOne).toBe(true);
  });

  it("goes back to one human and a CPU on leaving", () => {
    useMatchConfig.getState().configureOnline();
    useMatchConfig.getState().leaveOnline();
    expect(useMatchConfig.getState().players.map((p) => p.kind)).toEqual(["human", "cpu"]);
  });

  it("can record a match the connection ended", () => {
    useMatchConfig.getState().setResult({ kind: "connectionLost", placings: [], stats: [], fighters: {}, online: true });
    expect(useMatchConfig.getState().result?.kind).toBe("connectionLost");
  });
});
```

`src/lib/onlineStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DoSignalTransport } from "@/net/adapters/doSignal";
import type { LobbyMessage, OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, setActiveSession, type OnlineSessionLike, type SessionEvent } from "@/net/online/session";
import { ROLE_PORT, type Role } from "@/net/signalProtocol";
import { createEmitter } from "@/net/transport";
import { useMatchConfig } from "./matchConfig";
import { bindSession, leaveOnline, roomErrorMessage, sendLobby, useOnlineStore } from "./onlineStore";

function fakeSession() {
  const events = createEmitter<[SessionEvent]>();
  const sent: LobbyMessage[] = [];
  let role: Role | null = null;
  const session = {
    roomCode: "ABCD",
    get role() {
      return role;
    },
    get localPort() {
      return role === null ? null : ROLE_PORT[role];
    },
    turn: false,
    transport: {} as unknown as DoSignalTransport,
    on: (cb: (event: SessionEvent) => void) => events.add(cb),
    sendLobby: (message: LobbyMessage) => {
      sent.push(message);
    },
    close: vi.fn(),
  } satisfies OnlineSessionLike;
  const emit = (event: SessionEvent) => {
    if (event.type === "joined") role = event.role;
    events.emit(event);
  };
  return { session, sent, emit };
}

const CONFIG: OnlineMatchConfig = {
  seed: 1,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};

beforeEach(() => {
  leaveOnline();
  useMatchConfig.getState().reset();
});

describe("binding a session to the stores", () => {
  it("seats the players and records the role once the room answers", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    expect(useOnlineStore.getState()).toMatchObject({ role: "host", status: "waiting" });
    expect(useMatchConfig.getState().players.every((p) => p.kind === "human")).toBe(true);
  });

  it("goes from waiting to linking to connected", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  it("fills the opponent's panel from their pick, and only theirs", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 } });
    const [p0, p1] = useMatchConfig.getState().players;
    expect(p0).toMatchObject({ fighterId: "fox", costume: 2 });
    expect(p1.fighterId).toBeNull();
  });

  it("shows the guest the host's stage", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" } });
    expect(useOnlineStore.getState().hostStage).toEqual({ stageId: "smashville", form: "omega" });
    expect(useMatchConfig.getState()).toMatchObject({ stageId: "smashville", stageForm: "omega" });
  });

  it("takes the start config from the host, and only on the guest", () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "start", config: CONFIG } });
    expect(useOnlineStore.getState().config).toEqual(CONFIG);

    leaveOnline();
    const host = fakeSession();
    bindSession(host.session);
    host.emit({ type: "joined", role: "host" });
    host.emit({ type: "lobby", message: { kind: "start", config: CONFIG } });
    expect(useOnlineStore.getState().config).toBeNull();
  });

  it("explains a full room in words", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "error", reason: "full" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "full", error: "Room ABCD already has two players." });
  });

  it("says so when the opponent leaves the lobby", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "link", status: "open" });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", errorReason: "peer-left" });
  });

  it("records the opponent switching tabs", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "lobby", message: { kind: "away", away: true } });
    expect(useOnlineStore.getState().remoteAway).toBe(true);
  });
});

describe("sending and leaving", () => {
  it("sends lobby messages through the active session", () => {
    const { session, sent } = fakeSession();
    setActiveSession(session);
    sendLobby({ kind: "away", away: false });
    expect(sent).toEqual([{ kind: "away", away: false }]);
  });

  it("closes the session and resets both stores on leaving", () => {
    const { session, emit } = fakeSession();
    setActiveSession(session);
    bindSession(session);
    emit({ type: "joined", role: "host" });
    leaveOnline();
    expect(session.close).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(useMatchConfig.getState().players.map((p) => p.kind)).toEqual(["human", "cpu"]);
    emit({ type: "joined", role: "guest" });
    expect(useOnlineStore.getState().role).toBeNull();
  });

  it("has a sentence for every reason", () => {
    for (const reason of ["full", "taken", "not-found", "bad-message", "too-many-messages", "unreachable", "link-failed", "peer-left"] as const) {
      expect(roomErrorMessage(reason, "QRST").length).toBeGreaterThan(10);
    }
    expect(roomErrorMessage("not-found", "QRST")).toMatch(/QRST/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/lib/matchConfig.test.ts src/lib/onlineStore.test.ts`
Expected: FAIL — `useMatchConfig.getState().configureOnline is not a function`, and `Failed to resolve import "./onlineStore"`.

- [ ] **Step 3: Implement** — `src/lib/matchConfig.ts`:

Replace the `MatchResult` interface (lines 661–672) with:

```ts
export interface MatchResult {
  /** How the match ended — or that the network ended it first. */
  readonly kind: MatchOutcome["kind"] | "connectionLost";
  /** Ports in finishing order, winner first. Empty when the connection was lost. */
  readonly placings: readonly number[];
  readonly stats: readonly PlayerResultStat[];
  /**
   * The fighter each port actually played, captured when the match started.
   * Without it, a random pick or a change of mind on the way back to the
   * results screen would relabel a match that has already been played.
   */
  readonly fighters: Readonly<Record<number, string>>;
  /** Played online: no local rematch, and quitting leaves the room. */
  readonly online?: boolean;
}
```

In `interface MatchConfigState`, after `setScheme(port: number, scheme: SchemeId): boolean;` add:

```ts
  /** Two humans, one per machine, each on their own keyboard's Config 1. */
  configureOnline(): void;
  /** Back to the offline default: one human and a CPU. */
  leaveOnline(): void;
```

After `function initialPlayers(): PlayerSlot[] { … }` add:

```ts
function onlinePlayer(port: number): PlayerSlot {
  return { port, kind: "human", cpuLevel: 3, fighterId: null, costume: port, scheme: "arrows" };
}
```

In the `create<MatchConfigState>()` body, after the `setScheme: …` action add:

```ts
  configureOnline: () =>
    set((s) => {
      const players = [onlinePlayer(0), onlinePlayer(1)];
      return { players, rules: withDerivedRules(s.rules, players), result: null };
    }),

  // `result` is kept: the results screen calls this on its way out, and
  // clearing it there would flash "No match yet" before the navigation lands.
  leaveOnline: () =>
    set((s) => {
      const players = initialPlayers();
      return { players, rules: withDerivedRules(s.rules, players) };
    }),
```

`src/components/menu/Results.tsx:21-25` must gain the new kind or `tsc` fails — add the entry now (the screen's behaviour comes in Task 18):

```ts
const OUTCOME_LABELS: Record<MatchResult["kind"], string> = {
  stockOut: "Game Set",
  timeUp: "Time Up",
  suddenDeath: "Sudden Death",
  connectionLost: "Connection Lost",
};
```

`src/lib/onlineStore.ts`:

```ts
/**
 * What the online screens show, and the glue from a session's events to the
 * two stores.
 *
 * The session (src/net/online/session.ts) knows nothing about React; this is
 * where its events become a status line, a filled opponent panel, the host's
 * stage on the guest's screen, and the start config both play pages read.
 */

import { create } from "zustand";

import type { LobbyMessage, OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, setActiveSession, type OnlineSessionLike, type SessionError } from "@/net/online/session";
import type { Role } from "@/net/signalProtocol";
import type { Unsubscribe } from "@/net/transport";
import { useMatchConfig, type StageForm } from "./matchConfig";

export type OnlineStatus = "idle" | "connecting" | "waiting" | "linking" | "connected" | "error";
export type OnlineErrorReason = SessionError | "link-failed" | "peer-left";

export interface OnlineFields {
  status: OnlineStatus;
  roomCode: string | null;
  role: Role | null;
  error: string | null;
  errorReason: OnlineErrorReason | null;
  hostStage: { readonly stageId: string; readonly form: StageForm } | null;
  /** The host's start config; set on both peers when the match begins. */
  config: OnlineMatchConfig | null;
  remoteAway: boolean;
}

interface OnlineStoreState extends OnlineFields {
  patch(next: Partial<OnlineFields>): void;
  reset(): void;
}

const INITIAL: OnlineFields = {
  status: "idle",
  roomCode: null,
  role: null,
  error: null,
  errorReason: null,
  hostStage: null,
  config: null,
  remoteAway: false,
};

export const useOnlineStore = create<OnlineStoreState>()((set) => ({
  ...INITIAL,
  patch: (next) => set(next),
  reset: () => set(INITIAL),
}));

export function roomErrorMessage(reason: OnlineErrorReason, roomCode: string): string {
  switch (reason) {
    case "full":
      return `Room ${roomCode} already has two players.`;
    case "not-found":
      return `There is no room ${roomCode}. Check the code with the host.`;
    case "taken":
      return `Room ${roomCode} is already in use.`;
    case "unreachable":
      return "Online play needs the David-Smash Worker. Locally, run `pnpm preview` instead of `pnpm dev`.";
    case "link-failed":
      return "The direct connection could not be opened. Try again; strict networks need the TURN relay.";
    case "peer-left":
      return "The other player left the room.";
    case "bad-message":
    case "too-many-messages":
      return "The room closed the connection.";
  }
}

let unbind: Unsubscribe | null = null;

/** Mirror one session into the stores. Replaces any earlier binding. */
export function bindSession(session: OnlineSessionLike): Unsubscribe {
  unbind?.();
  const online = useOnlineStore.getState;
  const match = useMatchConfig.getState;
  const off = session.on((event) => {
    switch (event.type) {
      case "joined":
        match().configureOnline();
        online().patch({ role: event.role, status: "waiting", error: null, errorReason: null });
        break;
      case "peer":
        if (online().status !== "connected") online().patch({ status: event.present ? "linking" : "waiting" });
        break;
      case "link":
        if (event.status === "open") {
          online().patch({ status: "connected", error: null, errorReason: null });
        } else if (event.status === "failed") {
          online().patch({ status: "error", errorReason: "link-failed", error: roomErrorMessage("link-failed", session.roomCode) });
        } else if (event.status === "waiting" && online().status === "connected") {
          online().patch({ status: "waiting", config: null, errorReason: "peer-left", error: roomErrorMessage("peer-left", session.roomCode) });
        }
        break;
      case "lobby":
        applyLobby(event.message, session);
        break;
      case "error":
        online().patch({ status: "error", errorReason: event.reason, error: roomErrorMessage(event.reason, session.roomCode) });
        break;
    }
  });
  const release = () => {
    off();
    if (unbind === release) unbind = null;
  };
  unbind = release;
  return release;
}

function applyLobby(message: LobbyMessage, session: OnlineSessionLike): void {
  const local = session.localPort;
  const match = useMatchConfig.getState();
  switch (message.kind) {
    case "pick": {
      if (local === null) return;
      const remote = local === 0 ? 1 : 0;
      match.setFighter(remote, message.fighterId);
      match.setCostume(remote, message.costume);
      return;
    }
    case "stage":
      match.setStage(message.stageId);
      match.setStageForm(message.form);
      useOnlineStore.getState().patch({ hostStage: { stageId: message.stageId, form: message.form } });
      return;
    case "start":
      // Only the guest follows a start; the host built it.
      if (session.role === "guest") useOnlineStore.getState().patch({ config: message.config });
      return;
    case "away":
      useOnlineStore.getState().patch({ remoteAway: message.away });
      return;
  }
}

export function sendLobby(message: LobbyMessage): void {
  getActiveSession()?.sendLobby(message);
}

/** Close the room, forget the online state, and seat the offline default again. */
export function leaveOnline(): void {
  unbind?.();
  setActiveSession(null);
  useOnlineStore.getState().reset();
  useMatchConfig.getState().leaveOnline();
}
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/lib/matchConfig.test.ts src/lib/onlineStore.test.ts src/components/menu/Results.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/lib/onlineStore.ts super-smash/src/lib/onlineStore.test.ts super-smash/src/lib/matchConfig.ts super-smash/src/lib/matchConfig.test.ts super-smash/src/components/menu/Results.tsx
git commit -m "super-smash: an online store, and the match config's two-human online seating" -m "bindSession turns session events into lobby status, the opponent's pick, the host's stage and the start config. MatchResult can now say the connection was lost." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 15: `Btn.Soft` — a partial stick tilt walks, tilts and DIs lightly

**Files:**
- Modify: `super-smash/src/engine/types.ts:23-33` (`Btn`), `super-smash/src/engine/states.ts:125-148,196-254` (`Intent`, `interpretInput`), `super-smash/src/engine/constants.ts:239-240`, `super-smash/src/engine/knockback.ts:20-50,394-402` (`applyDI`), `super-smash/src/engine/simulate.ts:1018`, `super-smash/src/net/packet.ts:134`
- Test: `super-smash/src/engine/states.test.ts` (literal at :410-429, append), `super-smash/src/engine/knockback.test.ts` (import at :5-12, append), `super-smash/src/net/packet.test.ts` (append)

**Interfaces:**
- Produces: `Btn.Soft = 1 << 9`; `Intent.soft: boolean`; `applyDI(angleFx: number, stickX: number, stickY: number, soft?: boolean): number`; `SOFT_DI_SHIFT = 2` (constants.ts).
- Consumed by: Task 16 (`gamepad.ts` sets the bit), Task 17 (match runner passes it through untouched).

Engine note: the bit is in the existing 16-bit wire slot (`packet.ts` masks `& 0xffff`), it is not stored in `GameState`, and it uses only an integer shift — determinism and `layering.test.ts` are unaffected. Plan 2 restructures `states.ts`; it must carry `soft` across.

- [ ] **Step 1: Write the failing tests** — in `src/engine/states.test.ts`, add `soft: false,` after `sdiY: 0,` in the `const base: Intent = { … }` literal (line 428), then append:

```ts
describe("a soft stick (a gamepad's partial tilt, Btn.Soft)", () => {
  it("walks however long it is held, instead of dashing", () => {
    const f = fighter();
    hold(f, Btn.Right | Btn.Soft, 12);
    expect(f.action).toBe("walk");
  });

  it("still dashes at full deflection", () => {
    const f = fighter();
    hold(f, Btn.Right, 6);
    expect(f.action).toBe("dashStart");
  });

  it("turns a fresh direction plus attack into a tilt, not a smash", () => {
    const fresh = { framesSinceDirPress: 0, lastDirPressed: Btn.Right };
    const soft = interpretInput(fighter(fresh), Btn.Right | Btn.Soft | Btn.Attack, Btn.Right | Btn.Soft);
    expect(soft.attackPressed).toBe(true);
    expect(soft.smash).toBe(false);
    const hard = interpretInput(fighter(fresh), Btn.Right | Btn.Attack, Btn.Right);
    expect(hard.smash).toBe(true);
  });

  it("reports itself on the intent, for DI", () => {
    expect(interpretInput(fighter(), Btn.Up | Btn.Soft, 0).soft).toBe(true);
    expect(interpretInput(fighter(), Btn.Up, 0).soft).toBe(false);
  });
});
```

In `src/engine/knockback.test.ts` add `SOFT_DI_SHIFT,` to the `from "./constants"` import list (after `SAKURAI_GROUNDED,`), then append:

```ts
describe("applyDI with a soft stick", () => {
  it("bends a quarter as far as a full perpendicular push", () => {
    const full = applyDI(fx(0), 0, 1) - fx(0);
    const soft = applyDI(fx(0), 0, 1, true) - fx(0);
    expect(SOFT_DI_SHIFT).toBe(2);
    expect(soft).toBe(full >> SOFT_DI_SHIFT);
    expect(soft).toBeGreaterThan(0);
  });

  it("bends the other way just as softly", () => {
    expect(applyDI(fx(0), 0, -1, true) - fx(0)).toBe(-((applyDI(fx(0), 0, 1) - fx(0)) >> SOFT_DI_SHIFT));
  });

  it("does nothing at neutral", () => {
    expect(applyDI(fx(45), 0, 0, true)).toBe(fx(45));
  });
});
```

Append to `src/net/packet.test.ts`:

```ts
describe("the soft-stick bit", () => {
  it("survives the wire, since it is how a gamepad's walk reaches the other peer", () => {
    const inputs = [Btn.Right | Btn.Soft, Btn.Soft | Btn.Attack];
    const packet: Packet = { type: PacketType.Input, port: 1, senderFrame: 10, startFrame: 8, inputs };
    expect(decodePacket(encodePacket(packet))).toEqual(packet);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/engine/states.test.ts src/engine/knockback.test.ts src/net/packet.test.ts`
Expected: FAIL with assertion failures (vitest strips types and does not typecheck): `Btn.Soft` is `undefined` at runtime, so the walk test sees `expected 'dashStart' to be 'walk'`, `intent.soft` is `undefined` (`expected undefined to be true`), and the DI tests fail on `SOFT_DI_SHIFT` being `undefined`. "still dashes at full deflection" already passes — it is a regression check that the soft path does not disturb the keyboard's dash.

- [ ] **Step 3: Implement**

`src/engine/types.ts` — in the `InputFrame` doc comment above `export const enum Btn`, replace the sentence ending "never by the input layer." with "never by the input layer — with one exception, `Btn.Soft`, which only an analog stick can know." and add after `Grab = 1 << 8,`:

```ts
  /**
   * The stick is deflected, but not fully: a gamepad's partial tilt.
   *
   * A key is always a full deflection, so the keyboard never sets this. With
   * it, a held direction stays a walk instead of becoming a dash, a fresh
   * direction plus attack is a tilt instead of a smash, and DI bends a quarter
   * as far. It rides the input bitfield, so it crosses the wire and rolls back
   * like every other button.
   */
  Soft = 1 << 9,
```

`src/engine/states.ts` — in `interface Intent`, after `readonly sdiY: number;` add:

```ts
  /** `Btn.Soft`: a partial tilt. No dash, no smash, a quarter of the DI. */
  readonly soft: boolean;
```

In `interpretInput`, replace

```ts
  const smash =
    pressed(input, prev, Btn.Attack) &&
    dirStillHeld &&
    f.framesSinceDirPress <= SMASH_INPUT_WINDOW;
```

with

```ts
  // A partial tilt is what the keyboard's timing rules stand in for: the stick
  // that knows it is not fully deflected walks and tilts on its own say-so.
  const soft = held(input, Btn.Soft);
  const smash =
    pressed(input, prev, Btn.Attack) &&
    dirStillHeld &&
    !soft &&
    f.framesSinceDirPress <= SMASH_INPUT_WINDOW;
```

replace `    wantsDash: x !== 0 && f.framesSinceDirPress > DASH_THRESHOLD_FRAMES,` with `    wantsDash: x !== 0 && !soft && f.framesSinceDirPress > DASH_THRESHOLD_FRAMES,`, and replace `    sdiY: canPulse ? dir.y : 0,` with

```ts
    sdiY: canPulse ? dir.y : 0,
    soft,
```

`src/engine/constants.ts` — after `export const DI_MAX_DEVIATION = fx(9.74);` add:

```ts
/**
 * How much a soft stick (`Btn.Soft`) shortens DI, as a right shift: a quarter.
 *
 * DI scales with the square of the stick's perpendicular component (applyDI),
 * and a soft stick is read as half deflection: 0.5² = 0.25.
 * UNVERIFIED: the half-deflection reading is tuned, not sourced — the bitfield
 * carries one bit of magnitude where the real game reads the analog value.
 */
export const SOFT_DI_SHIFT = 2;
```

`src/engine/knockback.ts` — add `SOFT_DI_SHIFT,` to the `from "./constants"` import list (after `DI_MAX_DEVIATION,`); change the signature line to `export function applyDI(angleFx: number, stickX: number, stickY: number, soft = false): number {` and replace `  const deviation = mul(DI_MAX_DEVIATION, mul(perp, perp));` with

```ts
  const full = mul(DI_MAX_DEVIATION, mul(perp, perp));
  // A partial tilt is a shorter stick vector, and DI goes with its square.
  const deviation = soft ? full >> SOFT_DI_SHIFT : full;
```

`src/engine/simulate.ts:1018` — `const angle = applyDI(f.pendingAngle, relStick, intent.y);` → `const angle = applyDI(f.pendingAngle, relStick, intent.y, intent.soft);`

`src/net/packet.ts:134` — `// An InputFrame is a 9-bit button mask (see engine/types Btn); 16 bits` → `// An InputFrame is a 10-bit button mask (see engine/types Btn); 16 bits` and on the next line `// leaves room for seven more buttons before this needs revisiting.` → `// leaves room for six more buttons before this needs revisiting.`

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/engine src/net/packet.test.ts src/ai`
Expected: PASS (including `layering.test.ts`, which still finds no banned call).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/engine/types.ts super-smash/src/engine/states.ts super-smash/src/engine/states.test.ts super-smash/src/engine/constants.ts super-smash/src/engine/knockback.ts super-smash/src/engine/knockback.test.ts super-smash/src/engine/simulate.ts super-smash/src/net/packet.ts super-smash/src/net/packet.test.ts
git commit -m "super-smash: Btn.Soft — a partial stick tilt walks, tilts and DIs a quarter as far" -m "One more bit in the 16-bit input slot, so it crosses the wire and rolls back like any button. Integer shift only; layering.test.ts still green. The half-deflection DI reading is marked UNVERIFIED." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The gamepad sets `Btn.Soft`, merges with the keyboard, and maps pads to ports

**Files:**
- Modify: `super-smash/src/input/gamepad.ts:35,263-284` (+ new exports at the end)
- Test: `super-smash/src/input/gamepad.test.ts` (import at :4-14, append)

**Interfaces:**
- Consumes: `Btn.Soft` (Task 15).
- Produces: `export const DIRECTION_MASK: InputFrame`; `export function mergeKeyboardAndPad(keys: InputFrame, pad: InputFrame): InputFrame`; `export function padPortMap(ports: readonly number[]): (padIndex: number) => number`.

- [ ] **Step 1: Write the failing test** — add `DIRECTION_MASK, mergeKeyboardAndPad, padPortMap,` to the import list from `"./gamepad"` in `src/input/gamepad.test.ts`, then append:

```ts
describe("analog walk (Btn.Soft)", () => {
  const frameFor = (p: Gamepad) => new GamepadInput({ navigator: navigatorWith([p]) }).poll().frames[0];

  it("marks a partial tilt soft", () => {
    const frame = frameFor(pad({ axes: [0.5, 0] }));
    expect(held(frame, Btn.Right)).toBe(true);
    expect(held(frame, Btn.Soft)).toBe(true);
  });

  it("does not mark a full deflection soft", () => {
    const frame = frameFor(pad({ axes: [1, 0] }));
    expect(held(frame, Btn.Right)).toBe(true);
    expect(held(frame, Btn.Soft)).toBe(false);
  });

  it("never marks the d-pad soft, even with the stick tilted", () => {
    const frame = frameFor(pad({ buttons: [15], axes: [0.5, 0] }));
    expect(held(frame, Btn.Right)).toBe(true);
    expect(held(frame, Btn.Soft)).toBe(false);
  });

  it("leaves a stick at rest without the bit", () => {
    expect(frameFor(pad({ axes: [0, 0] }))).toBe(0);
  });
});

describe("mergeKeyboardAndPad", () => {
  it("lets a key's full deflection win over a soft stick", () => {
    expect(mergeKeyboardAndPad(Btn.Right, Btn.Right | Btn.Soft)).toBe(Btn.Right);
  });

  it("keeps the stick soft when the keyboard holds no direction", () => {
    expect(mergeKeyboardAndPad(Btn.Attack, Btn.Left | Btn.Soft)).toBe(Btn.Attack | Btn.Left | Btn.Soft);
  });

  it("covers the four directions in its mask", () => {
    expect(DIRECTION_MASK).toBe(Btn.Left | Btn.Right | Btn.Up | Btn.Down);
  });
});

describe("padPortMap", () => {
  it("gives the first pad to the first human port, the second to the second", () => {
    const map = padPortMap([0, 2]);
    expect(map(0)).toBe(0);
    expect(map(1)).toBe(2);
    expect(map(2)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/input/gamepad.test.ts`
Expected: FAIL — `mergeKeyboardAndPad is not a function` (and `expected false to be true` for the soft bit).

- [ ] **Step 3: Implement** — in `src/input/gamepad.ts`, replace the body of `packFrame` from the comment `// The stick contributes the same direction bits as the d-pad, OR'd, so a` to the end of the method with:

```ts
    // The stick contributes the same direction bits as the d-pad, OR'd, so a
    // player may use either without a mode switch.
    const fromPad = frame & DIRECTION_MASK;
    let fromStick: InputFrame = 0;
    if (stick.x >= WALK_THRESHOLD) fromStick |= Btn.Right;
    else if (stick.x <= -WALK_THRESHOLD) fromStick |= Btn.Left;
    if (stick.y >= WALK_THRESHOLD) fromStick |= Btn.Up;
    else if (stick.y <= -WALK_THRESHOLD) fromStick |= Btn.Down;
    frame |= fromStick;

    // The one thing the magnitude can carry over the wire: "not all the way".
    // A d-pad is digital, so a held d-pad direction is never soft.
    if (fromStick !== 0 && fromPad === 0 && stick.magnitude < DASH_THRESHOLD) frame |= Btn.Soft;

    return frame;
```

and append at the end of the file:

```ts
/* ------------------------------------------------------------- combining -- */

export const DIRECTION_MASK: InputFrame = Btn.Left | Btn.Right | Btn.Up | Btn.Down;

/**
 * One port's frame from both devices.
 *
 * A key is a full deflection, so a direction held on the keyboard cancels the
 * stick's "soft": otherwise a player resting a thumb on the stick could never
 * dash with the arrow keys.
 */
export function mergeKeyboardAndPad(keys: InputFrame, pad: InputFrame): InputFrame {
  const merged = keys | pad;
  return (keys & DIRECTION_MASK) !== 0 ? merged & ~Btn.Soft : merged;
}

/** Pad 0 drives the first human port, pad 1 the second; extra pads drive nothing. */
export function padPortMap(ports: readonly number[]): (padIndex: number) => number {
  return (padIndex) => ports[padIndex] ?? -1;
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/input/gamepad.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/input/gamepad.ts super-smash/src/input/gamepad.test.ts
git commit -m "super-smash: gamepads set Btn.Soft on a partial tilt; keyboard and pad merge per port" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: The match runner reads gamepads and drives a `RollbackSession` online

**Files:**
- Create: `super-smash/src/game/rollbackDeps.ts`, `super-smash/src/game/rollbackDeps.test.ts`
- Modify: `super-smash/src/game/matchRunner.ts:44,94-137,139-201,203-239,283-324`
- Test: `super-smash/src/game/matchRunner.test.ts` (imports at :16-25, append)

**Interfaces:**
- Consumes: `RollbackSession`, `RollbackDeps`, `NetStats`, `DesyncReport`, `MAX_PREDICTION_FRAMES` (`src/net/rollback.ts:66,129,173,181,338`); `Transport` (`src/net/transport.ts:22`); `GamepadInput`, `mergeKeyboardAndPad` (Task 16); `step`, `cloneState` (`src/engine/simulate.ts:437,172`); `hashState` (`src/engine/hash.ts:193`).
- Produces:
```ts
// src/game/rollbackDeps.ts
export const ENGINE_ROLLBACK_DEPS: RollbackDeps<GameState>;
// src/game/matchRunner.ts
export interface NetplayOptions { readonly transport: Transport; readonly localPorts: readonly number[]; readonly inputDelay?: number; readonly autoInputDelay?: boolean; readonly now?: () => number; readonly onDesync?: (report: DesyncReport) => void }
MatchRunnerOptions += { readonly gamepad?: Pick<GamepadInput, "poll"> | null; readonly net?: NetplayOptions | null }
MatchRunner += { dispose(): void; readonly netStats: NetStats | null; readonly stalled: boolean }
```

- [ ] **Step 1: Write the failing tests** — `src/game/rollbackDeps.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { hashState } from "@/engine/hash";
import { DEFAULT_SEED, createInitialState, step } from "@/engine/simulate";
import { Btn, type GameState, type MatchRules } from "@/engine/types";
import { bootstrapEngine } from "./bootstrap";
import { ENGINE_ROLLBACK_DEPS } from "./rollbackDeps";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 60 * 60 * 7, smashBall: false, oneOnOne: true };

/** Both fighters on the ground and actionable. */
function landed(): GameState {
  let state = createInitialState("battlefield", [{ defId: "mario" }, { defId: "fox" }], RULES, DEFAULT_SEED);
  for (let i = 0; i < 90; i++) state = step(state, [0, 0], { prevInputs: [0, 0] }).state;
  return state;
}

beforeAll(() => {
  bootstrapEngine();
});

describe("the engine, as the rollback session sees it", () => {
  it("passes prevInputs through, so a press is a press (D25)", () => {
    const state = landed();
    const press = ENGINE_ROLLBACK_DEPS.step(state, [Btn.Jump, 0], [0, 0]).state;
    const hold = ENGINE_ROLLBACK_DEPS.step(state, [Btn.Jump, 0], [Btn.Jump, 0]).state;
    expect(hashState(press)).not.toBe(hashState(hold));
  });

  it("is the engine's own step, exactly", () => {
    const state = landed();
    expect(hashState(ENGINE_ROLLBACK_DEPS.step(state, [Btn.Right, 0], [0, 0]).state)).toBe(
      hashState(step(state, [Btn.Right, 0], { prevInputs: [0, 0] }).state),
    );
  });

  it("clones deeply, so a saved frame cannot change behind the session's back", () => {
    const state = landed();
    const copy = ENGINE_ROLLBACK_DEPS.cloneState(state);
    expect(copy).not.toBe(state);
    expect(copy.fighters).not.toBe(state.fighters);
    expect(ENGINE_ROLLBACK_DEPS.hashState(copy)).toBe(hashState(state));
  });
});
```

In `src/game/matchRunner.test.ts` change the import block to:

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  FRAME_MS,
  createMatchRunner,
  type MatchAudio,
  type MatchRunner,
  type PlayerSlot,
} from "./matchRunner";
import { bootstrapEngine, getFighterOrThrow, getStageOrThrow } from "./bootstrap";
import { meleeReachFromDef } from "@/ai/behaviours";
import { hashState } from "@/engine/hash";
import { Btn, type InputFrame, type MatchRules } from "@/engine/types";
import { LoopbackNetwork } from "@/net/adapters/loopback";
import { MAX_PREDICTION_FRAMES } from "@/net/rollback";
import { createNullTransport, type Transport } from "@/net/transport";
```

and append:

```ts
/** A pad on port 0 whose frame the test sets. */
function fakePad(read: () => InputFrame) {
  return {
    poll(portCount = 4) {
      const frames = new Array<InputFrame>(portCount).fill(0);
      frames[0] = read();
      const none = new Array<InputFrame>(portCount).fill(0);
      return { frames, pressed: none, released: none, sticks: [], connectedPads: [0] };
    },
  };
}

function padRunner(read: () => InputFrame): MatchRunner {
  return createMatchRunner({
    stage: getStageOrThrow("battlefield"),
    players: [
      { selection: { defId: "mario" }, cpuLevel: null, label: "P1" },
      { selection: { defId: "donkeyKong" }, cpuLevel: null, label: "P2" },
    ],
    rules: RULES,
    seed: 0x5eed1e55,
    getFighter: getFighterOrThrow,
    gamepad: fakePad(read),
  });
}

describe("a gamepad drives a local match", () => {
  it("moves port 0 when the stick is pushed", () => {
    let held: InputFrame = 0;
    const runner = padRunner(() => held);
    runner.advance(90);
    const startX = runner.state.fighters[0].x;
    held = Btn.Right;
    runner.advance(30);
    expect(runner.state.fighters[0].x).toBeGreaterThan(startX);
  });

  it("walks on a partial tilt instead of dashing", () => {
    let held: InputFrame = 0;
    const runner = padRunner(() => held);
    runner.advance(90);
    held = Btn.Right | Btn.Soft;
    // Ten frames: well past the 3-frame dash window, and short of the edge of
    // Battlefield's left platform, which Mario walks off at frame 15.
    runner.advance(10);
    expect(runner.state.fighters[0].action).toBe("walk");
  });
});

describe("an online match runs through a RollbackSession", () => {
  const PLAYERS: PlayerSlot[] = [
    { selection: { defId: "mario" }, cpuLevel: null, label: "P1" },
    { selection: { defId: "donkeyKong" }, cpuLevel: null, label: "P2" },
  ];

  function online(transport: Transport, localPort: number, now?: () => number): MatchRunner {
    return createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: PLAYERS,
      rules: RULES,
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      net: { transport, localPorts: [localPort], inputDelay: 2, autoInputDelay: false, now },
    });
  }

  it("keeps both peers on the state one machine reaches, through latency and jitter", () => {
    const network = new LoopbackNetwork({ latencyMs: 40, jitterMs: 10, seed: 7 });
    const a = online(network.connect("A"), 0, () => network.now());
    const b = online(network.connect("B"), 1, () => network.now());
    for (let i = 0; i < 300; i++) {
      a.advance(1);
      b.advance(1);
      network.advance(FRAME_MS);
    }
    expect(a.frame).toBeGreaterThan(200);
    for (const peer of [a, b]) {
      const reference = idleRunner();
      reference.advance(peer.frame);
      expect(hashState(peer.state)).toBe(hashState(reference.state));
    }
    expect(a.netStats?.peers).toBe(1);
    expect(a.netStats?.desyncs).toBe(0);
  });

  it("stalls at the prediction cap while nobody has answered", () => {
    const runner = online(createNullTransport("alone"), 0);
    runner.advance(60);
    expect(runner.frame).toBeLessThanOrEqual(MAX_PREDICTION_FRAMES + 1);
    expect(runner.stalled).toBe(true);
  });

  it("has no rollback stats in a local match", () => {
    expect(idleRunner().netStats).toBeNull();
  });

  it("lets go of the transport on dispose", () => {
    const off = vi.fn();
    const transport: Transport = {
      selfId: "spy",
      send() {},
      onMessage: () => off,
      onPeerJoin: () => off,
      onPeerLeave: () => off,
      close() {},
    };
    online(transport, 0).dispose();
    expect(off).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/game/rollbackDeps.test.ts src/game/matchRunner.test.ts`
Expected: FAIL — `Failed to resolve import "./rollbackDeps"`; in matchRunner tests `expected 0 to be greater than …` (the pad is ignored) and `online(...).dispose is not a function`.

- [ ] **Step 3: Implement** — `src/game/rollbackDeps.ts`:

```ts
/**
 * The engine, in the shape `RollbackSession` asks for.
 *
 * `prevInputs` is threaded straight through: it is the parameter whose absence
 * once made every online press read as a hold (DECISIONS D25).
 */

import { hashState } from "@/engine/hash";
import { cloneState, step } from "@/engine/simulate";
import type { GameState } from "@/engine/types";
import type { RollbackDeps } from "@/net/rollback";

export const ENGINE_ROLLBACK_DEPS: RollbackDeps<GameState> = {
  step: (state, inputs, prevInputs) => step(state, inputs, { prevInputs }),
  cloneState,
  hashState,
};
```

`src/game/matchRunner.ts`:

1. After `import type { KeyboardInput } from "@/input/keyboard";` add:

```ts
import { mergeKeyboardAndPad, type GamepadInput } from "@/input/gamepad";
import { RollbackSession, type DesyncReport, type NetStats } from "@/net/rollback";
import type { Transport } from "@/net/transport";
import { ENGINE_ROLLBACK_DEPS } from "./rollbackDeps";
```

2. Before `export interface MatchRunnerOptions {` add:

```ts
/**
 * An online match. The runner hands its inputs to a `RollbackSession` instead
 * of stepping the engine itself; the session predicts the remote port, rolls
 * back when the real input lands, and stalls rather than guess past its cap.
 */
export interface NetplayOptions {
  readonly transport: Transport;
  /** The ports this machine supplies. Online v1: exactly one. */
  readonly localPorts: readonly number[];
  readonly inputDelay?: number;
  /** On by default; tests turn it off so both peers schedule identically. */
  readonly autoInputDelay?: boolean;
  /** RTT clock, for tests. Never reaches the simulation. */
  readonly now?: () => number;
  readonly onDesync?: (report: DesyncReport) => void;
}
```

3. In `MatchRunnerOptions`, after `readonly keyboard?: KeyboardInput | null;` add:

```ts
  /** Pads, polled once per tick and merged with the keyboard per port. */
  readonly gamepad?: Pick<GamepadInput, "poll"> | null;
  /** Present for an online match. */
  readonly net?: NetplayOptions | null;
```

4. In `MatchRunner`, after `redraw(): void;` add:

```ts
  /** Stop, and release the rollback session's hold on the transport. */
  dispose(): void;
  /** Rollback counters for the HUD; null in a local match. */
  readonly netStats: NetStats | null;
  /** The last tick was refused by the rollback session — waiting on the peer. */
  readonly stalled: boolean;
```

5. In the `createMatchRunner` destructuring, after `keyboard = null,` add `gamepad = null,` and `net = null,`.

6. After `let prevInputs: InputFrame[] = players.map(() => 0);` add:

```ts

  // Online, the session owns stepping: it saves, predicts, rolls back and
  // replays, and the runner only feeds it local input and draws what it says.
  const session = net
    ? new RollbackSession({
        transport: net.transport,
        deps: ENGINE_ROLLBACK_DEPS,
        initialState: state,
        playerCount: players.length,
        localPorts: net.localPorts,
        inputDelay: net.inputDelay,
        autoInputDelay: net.autoInputDelay,
        now: net.now,
        onDesync: net.onDesync,
      })
    : null;
  let stalled = false;
```

7. Replace `gatherInputs` with:

```ts
  function gatherInputs(): InputFrame[] {
    const drained = keyboard ? keyboard.drain() : null;
    // Exactly once per tick: a pad's press edges are the diff against the last poll.
    const pads = gamepad ? gamepad.poll(players.length) : null;
    return players.map((p, port) => {
      if (p.cpuLevel === null) return mergeKeyboardAndPad(drained?.frames[port] ?? 0, pads?.frames[port] ?? 0);
      const r = cpuInput(state, port, p.cpuLevel, cpuSeed, cpuWorlds[port]);
      cpuSeed = r.seed;
      return r.input;
    });
  }

  /**
   * Online, an outcome reached on a predicted frame can still be rolled back:
   * the KO may be undone by the input that arrives next. Only a frame whose
   * every input is confirmed may end the match.
   */
  function isFinal(): boolean {
    return session === null || session.confirmedFrame >= state.frame - 1;
  }
```

8. Replace the first six lines of `tick` —

```ts
  function tick(): void {
    const inputs = gatherInputs();
    previous = state;
    const result = step(state, inputs, { prevInputs });
    state = result.state;
    events = result.events;
    prevInputs = inputs;
```

— with

```ts
  function tick(): void {
    const inputs = gatherInputs();
    if (session) {
      const result = session.advance(inputs);
      stalled = !result.advanced;
      // A refused frame changed nothing: nothing to age, sound or report.
      if (!result.advanced) return;
      previous = state;
      state = result.state;
      events = result.events;
    } else {
      previous = state;
      const result = step(state, inputs, { prevInputs });
      state = result.state;
      events = result.events;
      prevInputs = inputs;
    }
```

and replace `    if (state.outcome && !ended) {` with `    if (state.outcome && !ended && isFinal()) {`.

9. In the returned object, after the `redraw() { paint(0); },` member add:

```ts
    dispose() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      session?.close();
    },
    get netStats() {
      return session ? session.stats() : null;
    },
    get stalled() {
      return stalled;
    },
```

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/game`
Expected: PASS (all of `src/game`, including the existing six cosmetic-drive tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/game/rollbackDeps.ts super-smash/src/game/rollbackDeps.test.ts super-smash/src/game/matchRunner.ts super-smash/src/game/matchRunner.test.ts
git commit -m "super-smash: the match runner reads gamepads and runs online matches through RollbackSession" -m "Pads are polled once per tick and merged with the keyboard per port. With net options the runner feeds a RollbackSession and draws what it returns; a match only ends on a confirmed frame. Two runners over a lossy loopback reach the single-machine state." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: The results screen says "Connection lost", and an online result leaves the room

**Files:**
- Modify: `super-smash/src/components/menu/Results.tsx:1-17,72-181`
- Test: `super-smash/src/components/menu/Results.test.tsx` (append)

**Interfaces:**
- Consumes: `MatchResult.kind === "connectionLost"`, `MatchResult.online` (Task 14); `leaveOnline` (Task 14); `setActiveSession`, `OnlineSessionLike` (Task 13).

- [ ] **Step 1: Write the failing test** — append to `src/components/menu/Results.test.tsx` (add the imports at the top of the file):

```tsx
import { vi } from "vitest";
import type { DoSignalTransport } from "@/net/adapters/doSignal";
import { getActiveSession, setActiveSession, type OnlineSessionLike } from "@/net/online/session";

describe("Results after an online match", () => {
  it("says the connection was lost instead of crowning anyone", async () => {
    useMatchConfig.getState().setResult({ kind: "connectionLost", placings: [], stats: [], fighters: { 0: "mario", 1: "fox" }, online: true });
    await renderResults();
    expect(screen.getByText("Connection Lost")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/connection to the other player was lost/i);
    expect(screen.queryByRole("button", { name: /rematch/i })).toBeNull();
  });

  it("offers no local rematch or fighter change after an online match", async () => {
    useMatchConfig.getState().setResult({ ...RESULT, online: true });
    await renderResults();
    expect(screen.queryByRole("button", { name: /rematch/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /change fighters/i })).toBeNull();
    expect(screen.getByRole("button", { name: /quit/i })).toBeInTheDocument();
  });

  it("leaves the room when quitting", async () => {
    const session = {
      roomCode: "ABCD",
      role: "host",
      localPort: 0,
      turn: false,
      transport: {} as unknown as DoSignalTransport,
      on: () => () => {},
      sendLobby: () => {},
      close: vi.fn(),
    } satisfies OnlineSessionLike;
    setActiveSession(session);
    useMatchConfig.getState().setResult({ ...RESULT, online: true });
    await renderResults();
    fireEvent.click(screen.getByRole("button", { name: /quit/i }));
    expect(session.close).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
  });

  it("leaves the room from the back button too", async () => {
    const close = vi.fn();
    setActiveSession({
      roomCode: "ABCD",
      role: "guest",
      localPort: 1,
      turn: false,
      transport: {} as unknown as DoSignalTransport,
      on: () => () => {},
      sendLobby: () => {},
      close,
    });
    useMatchConfig.getState().setResult({ ...RESULT, online: true });
    await renderResults();
    fireEvent.click(screen.getByRole("button", { name: "Back to the main menu" }));
    expect(close).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
  });
});
```

(Fold `vi` into the existing `import { beforeEach, describe, expect, it } from "vitest";` line rather than adding a second vitest import.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/components/menu/Results.test.tsx`
Expected: FAIL — `Unable to find role="status"`, and the Rematch button is still present.

- [ ] **Step 3: Implement** — in `src/components/menu/Results.tsx` add `import { leaveOnline } from "@/lib/onlineStore";` after the `@/lib/matchConfig` import; in the main return's `ScreenBanner`, replace `onBack={() => router.push("/menu")}` with

```tsx
        onBack={() => {
          if (result.online) leaveOnline();
          router.push("/menu");
        }}
```

(the empty-result branch's banner stays as it is); then insert directly after `<div className="mx-auto w-full max-w-6xl flex-1 px-5 pb-10 sm:px-8">`:

```tsx
        {result.kind === "connectionLost" ? (
          <p role="status" className="mb-6 text-center text-sm font-bold text-white/80">
            The connection to the other player was lost before the match finished. Nobody wins this one.
          </p>
        ) : null}
```

and replace the three-button block (from `<SkewButton onClick={() => router.push("/play")}` through the `Quit` button's closing `</SkewButton>`) with:

```tsx
          {result.online ? null : (
            <>
              <SkewButton
                onClick={() => router.push("/play")}
                className="border-[4px] border-panel-ink bg-smash-yellow px-8 py-3 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-1"
                innerClassName="font-display text-xl tracking-[0.16em] uppercase"
              >
                Rematch
              </SkewButton>
              <SkewButton
                onClick={() => router.push("/fighters")}
                className="border-[3px] border-panel-ink bg-panel-bone px-6 py-3 text-panel-ink transition-transform hover:-translate-y-1"
                innerClassName="font-display text-lg tracking-[0.14em] uppercase"
              >
                Change Fighters
              </SkewButton>
            </>
          )}
          <SkewButton
            onClick={() => {
              // An online result still holds the room open; quitting is leaving it.
              if (result.online) leaveOnline();
              router.push("/menu");
            }}
            className="border-[3px] border-panel-ink bg-[#2a2d33] px-6 py-3 text-white/80 transition-transform hover:-translate-y-1"
            innerClassName="font-display text-lg tracking-[0.14em] uppercase"
          >
            Quit
          </SkewButton>
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/components/menu/Results.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/components/menu/Results.tsx super-smash/src/components/menu/Results.test.tsx
git commit -m "super-smash: results say Connection Lost, and an online result's Quit leaves the room" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 19: The Online tile goes live: `/online` with Create room / Join room

**Files:**
- Create: `super-smash/src/components/online/OnlineLobby.tsx`, `super-smash/src/components/online/OnlineLobby.test.tsx`, `super-smash/src/app/online/page.tsx`
- Modify: `super-smash/src/components/menu/MainMenu.tsx:43`, `super-smash/src/components/menu/MainMenu.test.tsx:27-35` (+ append), `super-smash/e2e/flow.spec.ts:21-33` (the Online tile is no longer dimmed; the `<title>` is checked)

**Interfaces:**
- Consumes: `makeRoomCode`, `normalizeRoomCode`, `roomCodeProblem` (Task 3); `OnlineSession.open`, `OpenSessionOptions`, `OnlineSessionLike`, `setActiveSession` (Task 13); `bindSession`, `leaveOnline`, `roomErrorMessage`, `useOnlineStore` (Task 14); `ModeTab`, `ScreenBanner` (`src/components/ui/Panel.tsx:74,123`); `SkewButton`, `SkewPanel` (`src/components/ui/SkewPanel.tsx:40,57`); `pageTitle` (Task 1).
- Produces: `export type OpenSession = (roomCode: string, intent: RoomIntent, options: OpenSessionOptions) => Promise<OnlineSessionLike>`; `export function OnlineLobby(props: { openSession?: OpenSession }): JSX.Element`; route `/online` (`out/online.html`). Host lands on `/stage`, guest on `/fighters`, when the DataChannel opens. `?ice=relay` on `/online` forces TURN (used by the public e2e).

- [ ] **Step 1: Write the failing tests** — `src/components/online/OnlineLobby.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import type { DoSignalTransport } from "@/net/adapters/doSignal";
import type { OnlineSessionLike, SessionEvent } from "@/net/online/session";
import { ROLE_PORT, type Role, type RoomIntent } from "@/net/signalProtocol";
import { createEmitter } from "@/net/transport";
import { OnlineLobby, type OpenSession } from "./OnlineLobby";

interface Opened {
  readonly code: string;
  readonly intent: RoomIntent;
  readonly session: OnlineSessionLike & { close: ReturnType<typeof vi.fn> };
  emit(event: SessionEvent): void;
}

function harness() {
  const opened: Opened[] = [];
  const openSession = vi.fn<OpenSession>(async (code, intent) => {
    const events = createEmitter<[SessionEvent]>();
    let role: Role | null = null;
    const session = {
      roomCode: code,
      get role() {
        return role;
      },
      get localPort() {
        return role === null ? null : ROLE_PORT[role];
      },
      turn: false,
      transport: {} as unknown as DoSignalTransport,
      on: (cb: (event: SessionEvent) => void) => events.add(cb),
      sendLobby: () => {},
      close: vi.fn(),
    };
    opened.push({
      code,
      intent,
      session,
      emit: (event) => {
        if (event.type === "joined") role = event.role;
        events.emit(event);
      },
    });
    return session;
  });
  render(<OnlineLobby openSession={openSession} />);
  return { opened, openSession };
}

async function join(code: string) {
  fireEvent.change(screen.getByLabelText("Room code"), { target: { value: code } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /join room/i }));
  });
}

beforeEach(() => {
  leaveOnline();
  routerMock.push.mockClear();
});

describe("OnlineLobby", () => {
  it("creates a room and shows its code once the room makes us host", async () => {
    const { opened } = harness();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create room/i }));
    });
    expect(opened[0].intent).toBe("create");
    act(() => opened[0].emit({ type: "joined", role: "host" }));
    expect(screen.getByTestId("room-code")).toHaveTextContent(opened[0].code);
  });

  it("joins a code typed in lowercase with a dash", async () => {
    const { opened } = harness();
    await join("qr-st");
    expect(opened[0]).toMatchObject({ code: "QRST", intent: "join" });
  });

  it("explains a code with an O instead of joining another room", async () => {
    const { openSession } = harness();
    await join("abod");
    expect(screen.getByRole("alert")).toHaveTextContent(/never use I, O, 1 or 0/);
    expect(openSession).not.toHaveBeenCalled();
  });

  it("tells a third player the room is full, and lets them try another code", async () => {
    const { opened } = harness();
    await join("ABCD");
    act(() => opened[0].emit({ type: "error", reason: "full" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Room ABCD already has two players.");
    expect(screen.getByRole("button", { name: /join room/i })).toBeInTheDocument();
  });

  it("makes a new code when the first one is already taken", async () => {
    const { opened } = harness();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create room/i }));
    });
    await act(async () => {
      opened[0].emit({ type: "error", reason: "taken" });
    });
    expect(opened).toHaveLength(2);
    expect(opened[1].intent).toBe("create");
    expect(opened[0].session.close).toHaveBeenCalled();
  });

  it("sends the host to the stage select once the direct link is open", async () => {
    const { opened } = harness();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create room/i }));
    });
    act(() => {
      opened[0].emit({ type: "joined", role: "host" });
      opened[0].emit({ type: "peer", present: true });
      opened[0].emit({ type: "link", status: "open" });
    });
    expect(routerMock.push).toHaveBeenCalledWith("/stage");
  });

  it("sends the guest to the character select once the direct link is open", async () => {
    const { opened } = harness();
    await join("ABCD");
    act(() => {
      opened[0].emit({ type: "joined", role: "guest" });
      opened[0].emit({ type: "link", status: "open" });
    });
    expect(routerMock.push).toHaveBeenCalledWith("/fighters");
  });

  it("does not bounce back into a room left open earlier", async () => {
    useOnlineStore.getState().patch({ status: "connected", role: "host", roomCode: "ABCD" });
    harness();
    await act(async () => {});
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(screen.getByRole("button", { name: /create room/i })).toBeInTheDocument();
  });

  it("says when there is no Worker to talk to", async () => {
    const { opened } = harness();
    await join("ABCD");
    act(() => opened[0].emit({ type: "error", reason: "unreachable" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/pnpm preview/);
  });

  it("leaves the room from the back button", async () => {
    const { opened } = harness();
    await join("ABCD");
    fireEvent.click(screen.getByRole("button", { name: "Back to the main menu" }));
    expect(opened[0].session.close).toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
  });
});
```

In `src/components/menu/MainMenu.test.tsx`, change the test `"shows every mode, and disables the four that are out of scope"` to:

```tsx
  it("shows every mode, and disables the three that are out of scope", async () => {
    await renderMenu();

    for (const label of ["Spirits", "Games & More", "Vault"]) {
      const tile = screen.getByRole("button", { name: new RegExp(label, "i") });
      expect(tile).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getByRole("button", { name: /^smash/i })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: /online/i })).not.toHaveAttribute("aria-disabled");
  });
```

and append:

```tsx
  it("opens the online lobby from the Online tile", async () => {
    await renderMenu();

    fireEvent.click(screen.getByRole("button", { name: /online/i }));

    expect(routerMock.push).toHaveBeenCalledWith("/online");
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/components/online src/components/menu/MainMenu.test.tsx`
Expected: FAIL — `Failed to resolve import "./OnlineLobby"`; MainMenu: Online tile has `aria-disabled="true"`.

- [ ] **Step 3: Implement** — `src/components/online/OnlineLobby.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
import { SkewButton, SkewPanel } from "@/components/ui/SkewPanel";
import { bindSession, leaveOnline, roomErrorMessage, useOnlineStore } from "@/lib/onlineStore";
import { OnlineSession, setActiveSession, type OnlineSessionLike, type OpenSessionOptions } from "@/net/online/session";
import { makeRoomCode, normalizeRoomCode, roomCodeProblem } from "@/net/roomCode";
import type { RoomIntent } from "@/net/signalProtocol";

export type OpenSession = (roomCode: string, intent: RoomIntent, options: OpenSessionOptions) => Promise<OnlineSessionLike>;

/** A fresh four-letter code colliding three times running means something else is wrong. */
const MAX_CREATE_ATTEMPTS = 3;

/**
 * Online: make a room and read its code out, or type the code you were given.
 *
 * Nothing here plays. It opens the session, shows where the handshake has
 * got to, and once the direct connection is up hands over to the existing
 * screens — the host to stage select (the host picks the stage), the guest
 * straight to character select.
 */
export function OnlineLobby({ openSession = OnlineSession.open }: { openSession?: OpenSession }) {
  const router = useRouter();
  const status = useOnlineStore((s) => s.status);
  const role = useOnlineStore((s) => s.role);
  const roomCode = useOnlineStore((s) => s.roomCode);
  const error = useOnlineStore((s) => s.error);
  const errorReason = useOnlineStore((s) => s.errorReason);

  const [typed, setTyped] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const createAttempts = useRef(0);
  /** Only a room opened from this screen may move the player on. */
  const openedHere = useRef(false);

  // Arriving here always starts afresh: a room left open by a back button or
  // a finished match must not bounce the player straight back into it.
  useEffect(() => {
    leaveOnline();
  }, []);

  const connect = useCallback(
    async (code: string, intent: RoomIntent) => {
      openedHere.current = true;
      useOnlineStore.getState().patch({
        status: "connecting",
        roomCode: code,
        role: null,
        error: null,
        errorReason: null,
        config: null,
        hostStage: null,
      });
      // `?ice=relay` forces TURN, so a test can prove the relay works.
      const forceRelay = new URLSearchParams(window.location.search).get("ice") === "relay";
      try {
        const session = await openSession(code, intent, { forceRelay });
        setActiveSession(session);
        bindSession(session);
      } catch {
        useOnlineStore.getState().patch({ status: "error", errorReason: "unreachable", error: roomErrorMessage("unreachable", code) });
      }
    },
    [openSession],
  );

  // No React state is set in here: the retry effect below calls it.
  const create = useCallback(() => {
    createAttempts.current += 1;
    void connect(makeRoomCode(), "create");
  }, [connect]);

  const join = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = roomCodeProblem(typed);
    setFormError(problem);
    const code = normalizeRoomCode(typed);
    if (problem || code === null) return;
    createAttempts.current = 0;
    void connect(code, "join");
  };

  // A freshly made code somebody else is using: quietly make another.
  useEffect(() => {
    if (status === "error" && errorReason === "taken" && createAttempts.current < MAX_CREATE_ATTEMPTS) create();
  }, [create, errorReason, status]);

  useEffect(() => {
    if (openedHere.current && status === "connected" && role !== null) router.push(role === "host" ? "/stage" : "/fighters");
  }, [role, router, status]);

  const busy = status === "connecting" || status === "waiting" || status === "linking" || status === "connected";
  const message = formError ?? error;

  return (
    <main className="flex min-h-dvh flex-col bg-[#101215]">
      <ScreenBanner
        onBack={() => {
          leaveOnline();
          router.push("/menu");
        }}
        backLabel="Back to the main menu"
        tab={<ModeTab label="Online" caret={false} />}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
        <h1 className="font-display text-4xl tracking-[0.08em] text-white uppercase">Online</h1>

        {busy && role === "host" && status !== "connected" ? (
          <SkewPanel className="border-[3px] border-panel-ink bg-panel-bone" innerClassName="px-8 py-6 text-panel-ink">
            <p className="text-sm font-bold">Your room code</p>
            <p data-testid="room-code" className="font-display text-6xl tracking-[0.3em]">
              {roomCode}
            </p>
            <p className="mt-2 text-sm">
              {status === "linking" ? "They are in. Opening a direct connection…" : "Read it to the other player. Waiting for them to join…"}
            </p>
          </SkewPanel>
        ) : busy ? (
          <p role="status" className="text-white/80">
            {status === "linking" ? "Opening a direct connection…" : `Connecting to room ${roomCode ?? ""}…`}
          </p>
        ) : (
          <>
            <SkewButton
              onClick={() => {
                setFormError(null);
                createAttempts.current = 0;
                create();
              }}
              className="self-start border-[4px] border-panel-ink bg-smash-yellow px-8 py-4 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)]"
              innerClassName="font-display text-2xl tracking-[0.16em] uppercase"
            >
              Create room
            </SkewButton>
            <form onSubmit={join} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm font-bold text-white/80">
                Room code
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  maxLength={6}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="w-40 border-[3px] border-panel-ink bg-white px-3 py-2 font-display text-2xl tracking-[0.3em] text-panel-ink uppercase"
                />
              </label>
              <SkewButton
                type="submit"
                className="border-[3px] border-panel-ink bg-panel-bone px-6 py-3 text-panel-ink"
                innerClassName="font-display text-lg tracking-[0.14em] uppercase"
              >
                Join room
              </SkewButton>
            </form>
          </>
        )}

        {message ? (
          <p role="alert" className="text-sm font-bold text-smash-yellow">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
```

`src/app/online/page.tsx`:

```tsx
import type { Metadata } from "next";

import { OnlineLobby } from "@/components/online/OnlineLobby";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Online") };

export default function Page() {
  return <OnlineLobby />;
}
```

`src/components/menu/MainMenu.tsx:43` — replace

```ts
  { id: "online", label: "Online", sublabel: "Not built", colour: "var(--color-mode-online)" },
```

with

```ts
  { id: "online", label: "Online", sublabel: "2 players · room code", colour: "var(--color-mode-online)", href: "/online" },
```

and in the `MODES` doc comment replace "Four of them are out of scope" with "Three of them are out of scope".

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/components/online src/components/menu/MainMenu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Keep the e2e flow honest about the menu** — in `e2e/flow.spec.ts`, replace the test `"the main menu offers Smash and dims what is out of scope"` with:

```ts
test("the main menu offers Smash and Online, and dims what is out of scope", async ({ page }) => {
  await startFromTitle(page);
  const smash = page.getByRole("button", { name: /smash/i }).first();
  await expect(smash).toBeVisible();
  await expect(smash).toBeEnabled();
  await expect(page.getByRole("button", { name: /online/i }).first()).toBeEnabled();

  // The other three modes are deliberately present but disabled — their absence
  // would misrepresent the game more than their being greyed out does.
  for (const mode of ["Spirits", "Games & More", "Vault"]) {
    const tile = page.getByRole("button", { name: new RegExp(mode, "i") }).first();
    if (await tile.count()) await expect(tile).toBeDisabled();
  }
});

test("the tab is titled David-Smash", async ({ page }) => {
  await page.goto(ROUTES.title);
  await expect(page).toHaveTitle("David-Smash");
});
```

Run: `PORT=3107 pnpm test:e2e e2e/flow.spec.ts`
Expected: PASS.

- [ ] **Step 6: Full gate, and check the route is exported**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && test -f out/online.html && echo ok`
Expected: exit 0, prints `ok`.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/components/online/OnlineLobby.tsx super-smash/src/components/online/OnlineLobby.test.tsx super-smash/src/app/online/page.tsx super-smash/src/components/menu/MainMenu.tsx super-smash/src/components/menu/MainMenu.test.tsx super-smash/e2e/flow.spec.ts
git commit -m "super-smash: the Online tile opens a lobby — create a room and read the code out, or join one" -m "Lowercase and dashes join; O/I/0/1 are explained, never guessed; a full room says so; a taken fresh code is replaced. The host goes to stage select and the guest to fighters once the direct link is open." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Stage and character select in online mode (host picks the stage and starts)

**Files:**
- Modify: `super-smash/src/components/menu/CharacterSelect.tsx` (imports :12-27; component :53-95, :101-158, :160-176, :303-354; `PlayerPanel` :361-480), `super-smash/src/components/menu/StageSelect.tsx` (imports :12-20; :30-35, :59, :166-172)
- Create: `super-smash/src/components/menu/CharacterSelect.online.test.tsx`
- Test: `super-smash/src/components/menu/StageSelect.test.tsx` (append)

**Interfaces:**
- Consumes: `useOnlineStore`, `sendLobby` (Task 14); `ROLE_PORT` (Task 4); `buildStartConfig`, `newMatchSeed` (Task 12); `setActiveSession`, `OnlineSessionLike` (Task 13); `findStage` (`src/lib/matchConfig.ts:451`).
- Produces (behaviour): online, each peer edits only its own panel and sends `pick`; port keys and +/- do nothing; the host's Ready sends `start` and both peers go to `/play`; the guest's button reads "Waiting for Host"; StageSelect's Next sends `stage` when hosting.

- [ ] **Step 1: Write the failing tests** — `src/components/menu/CharacterSelect.online.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { resetRosterCache, useMatchConfig } from "@/lib/matchConfig";
import { leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import type { DoSignalTransport } from "@/net/adapters/doSignal";
import type { LobbyMessage, OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, setActiveSession, type OnlineSessionLike } from "@/net/online/session";
import { ROLE_PORT, type Role } from "@/net/signalProtocol";
import { CharacterSelect } from "./CharacterSelect";

const portraits = () => screen.getAllByRole("button", { name: /, number \d/i });

const CONFIG: OnlineMatchConfig = {
  seed: 9,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};

function goOnline(role: Role): LobbyMessage[] {
  const sent: LobbyMessage[] = [];
  const session = {
    roomCode: "ABCD",
    role,
    localPort: ROLE_PORT[role],
    turn: false,
    transport: {} as unknown as DoSignalTransport,
    on: () => () => {},
    sendLobby: (message: LobbyMessage) => {
      sent.push(message);
    },
    close: vi.fn(),
  } satisfies OnlineSessionLike;
  setActiveSession(session);
  useMatchConfig.getState().configureOnline();
  useOnlineStore.getState().patch({ role, status: "connected", roomCode: "ABCD" });
  return sent;
}

async function renderSelect() {
  render(<CharacterSelect />);
  await act(async () => {});
}

beforeEach(() => {
  leaveOnline();
  useMatchConfig.getState().reset();
  resetRosterCache();
  routerMock.push.mockClear();
});

describe("CharacterSelect, online", () => {
  it("lets a peer fill only its own panel, and tells the other side", async () => {
    const sent = goOnline("guest");
    await renderSelect();
    fireEvent.click(portraits()[0]);
    const [p0, p1] = useMatchConfig.getState().players;
    expect(p0.fighterId).toBeNull();
    expect(p1.fighterId).not.toBeNull();
    expect(sent).toEqual([{ kind: "pick", fighterId: p1.fighterId, costume: 1 }]);
  });

  it("ignores the keys that switch ports in a local match", async () => {
    goOnline("host");
    await renderSelect();
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.click(portraits()[0]);
    expect(useMatchConfig.getState().players[0].fighterId).not.toBeNull();
    expect(useMatchConfig.getState().players[1].fighterId).toBeNull();
  });

  it("hides adding and removing players", async () => {
    goOnline("host");
    await renderSelect();
    expect(screen.queryByRole("button", { name: "Add a player" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove a player" })).toBeNull();
  });

  it("lets the host start the match for both", async () => {
    const sent = goOnline("host");
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();
    fireEvent.click(screen.getByRole("button", { name: /ready to fight/i }));
    const start = sent.find((m) => m.kind === "start");
    expect(start).toMatchObject({ kind: "start", config: { fighters: ["mario", "fox"], stageId: "battlefield" } });
    expect(useOnlineStore.getState().config).toEqual(start && start.kind === "start" ? start.config : null);
    expect(routerMock.push).toHaveBeenCalledWith("/play");
  });

  it("keeps the guest's button off, and follows the host into the match", async () => {
    goOnline("guest");
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();
    expect(screen.getByRole("button", { name: /waiting for host/i })).toBeDisabled();
    act(() => useOnlineStore.getState().patch({ config: CONFIG }));
    expect(routerMock.push).toHaveBeenCalledWith("/play");
  });

  it("shows the guest which stage the host picked", async () => {
    goOnline("guest");
    useOnlineStore.getState().patch({ hostStage: { stageId: "battlefield", form: "normal" } });
    await renderSelect();
    expect(screen.getByText(/stage: battlefield/i)).toBeInTheDocument();
  });

  it("makes the guest's back button leave the room", async () => {
    goOnline("guest");
    await renderSelect();
    fireEvent.click(screen.getByRole("button", { name: "Leave the room" }));
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(routerMock.push).toHaveBeenCalledWith("/online");
  });
});
```

Append to `src/components/menu/StageSelect.test.tsx` (merge the new imports into the top of the file):

```tsx
import { vi } from "vitest";
import { leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import type { DoSignalTransport } from "@/net/adapters/doSignal";
import type { LobbyMessage } from "@/net/online/lobby";
import { getActiveSession, setActiveSession, type OnlineSessionLike } from "@/net/online/session";

describe("StageSelect, hosting online", () => {
  function host(): LobbyMessage[] {
    const sent: LobbyMessage[] = [];
    const session = {
      roomCode: "ABCD",
      role: "host",
      localPort: 0,
      turn: false,
      transport: {} as unknown as DoSignalTransport,
      on: () => () => {},
      sendLobby: (message: LobbyMessage) => {
        sent.push(message);
      },
      close: vi.fn(),
    } satisfies OnlineSessionLike;
    setActiveSession(session);
    useOnlineStore.getState().patch({ role: "host", status: "connected", roomCode: "ABCD" });
    return sent;
  }

  it("tells the guest the stage on the way to fighters", async () => {
    const sent = host();
    await renderStages();
    fireEvent.click(screen.getByRole("button", { name: /choose fighters/i }));
    expect(sent).toEqual([{ kind: "stage", stageId: "battlefield", form: "normal" }]);
    expect(routerMock.push).toHaveBeenCalledWith("/fighters");
    leaveOnline();
  });

  it("leaves the room instead of going back to the rules", async () => {
    host();
    await renderStages();
    fireEvent.click(screen.getByRole("button", { name: "Leave the room" }));
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(routerMock.push).toHaveBeenCalledWith("/online");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/components/menu/CharacterSelect.online.test.tsx src/components/menu/StageSelect.test.tsx`
Expected: FAIL — e.g. the guest's pick lands on port 0, "Add a player" is present, `sent` stays empty, and there is no "Leave the room" button.

- [ ] **Step 3: Implement** — `src/components/menu/CharacterSelect.tsx`:

(a) Add `findStage,` to the `@/lib/matchConfig` import list (after `findFighter,`), and after that import block add:

```ts
import { buildStartConfig, newMatchSeed } from "@/game/onlineConfig";
import { leaveOnline, sendLobby, useOnlineStore } from "@/lib/onlineStore";
import { ROLE_PORT } from "@/net/signalProtocol";
```

(b) After `const removePlayer = useMatchConfig((s) => s.removePlayer);` add:

```ts
  const stageId = useMatchConfig((s) => s.stageId);
  const stageForm = useMatchConfig((s) => s.stageForm);
  const rules = useMatchConfig((s) => s.rules);

  // Online, each machine owns exactly one panel: the host P1, the guest P2.
  // The other panel is filled by the opponent's own pick (lib/onlineStore).
  const onlineRole = useOnlineStore((s) => s.role);
  const onlineConfig = useOnlineStore((s) => s.config);
  const hostStage = useOnlineStore((s) => s.hostStage);
  const onlinePort = onlineRole === null ? null : ROLE_PORT[onlineRole];
```

(c) Replace `  const activePort = Math.min(requestedPort, players.length - 1);` with `  const activePort = onlinePort ?? Math.min(requestedPort, players.length - 1);`

(d) Replace the `assign` callback with:

```ts
  const assign = useCallback(
    (fighterId: string) => {
      setFighter(activePort, fighterId);
      if (onlinePort !== null) {
        sendLobby({ kind: "pick", fighterId, costume: players[activePort]?.costume ?? activePort });
        return;
      }
      // Hand the cursor to the next empty panel, so filling four ports is four
      // presses rather than four presses and three port switches.
      const next = players.find((p) => p.port !== activePort && p.fighterId === null);
      if (next) setActivePort(next.port);
    },
    [activePort, onlinePort, players, setFighter],
  );
```

(e) In the keydown handler: in `case "Backspace":` insert `if (onlinePort !== null) sendLobby({ kind: "pick", fighterId: null, costume: activePort });` after `setFighter(activePort, null);`; make the first line of both the `case "+": case "=":` block and the `case "-": case "_":` block `if (onlinePort !== null) return;`; replace `if (Number.isInteger(port) && port >= 0 && port < players.length) {` with `if (onlinePort === null && Number.isInteger(port) && port >= 0 && port < players.length) {`; add `onlinePort` to that effect's dependency array.

(f) After that keydown `useEffect`, add:

```ts
  // The guest follows the host into the match the moment the start arrives.
  useEffect(() => {
    if (onlineRole === "guest" && onlineConfig) router.push("/play");
  }, [onlineConfig, onlineRole, router]);

  const startMatch = () => {
    if (onlineRole === null) {
      router.push("/play");
      return;
    }
    if (onlineRole !== "host") return;
    const config = buildStartConfig({ players, stageId, stageForm, rules, seed: newMatchSeed() });
    useOnlineStore.getState().patch({ config });
    sendLobby({ kind: "start", config });
    router.push("/play");
  };

  const canStart = ready && onlineRole !== "guest";
  const bannerTag =
    onlineRole === "guest"
      ? hostStage
        ? `Stage: ${findStage(roster, hostStage.stageId)?.name ?? "Random"}`
        : "The host is picking the stage"
      : onlineRole === "host"
        ? "Online"
        : `${players.length} fighters`;
```

(g) In the `ScreenBanner`, replace `onBack={() => router.push("/stage")}` and `backLabel="Back to stage select"` with

```tsx
        onBack={() => {
          // The guest has no stage select to go back to: going back is leaving.
          if (onlineRole === "guest") {
            leaveOnline();
            router.push("/online");
          } else {
            router.push("/stage");
          }
        }}
        backLabel={onlineRole === "guest" ? "Leave the room" : "Back to stage select"}
```

and replace the tag's content `{players.length} fighters` with `{bannerTag}`. Import `leaveOnline` alongside `sendLobby, useOnlineStore` from `@/lib/onlineStore`.

(h) In the footer's `players.map(...)`, replace the `PlayerPanel` element with:

```tsx
            <PlayerPanel
              key={player.port}
              player={player}
              fighter={findFighter(roster, player.fighterId)}
              active={player.port === activePort}
              onActivate={() => {
                if (onlinePort === null) setActivePort(player.port);
              }}
              online={onlinePort !== null}
              local={player.port === onlinePort}
            />
```

(i) Wrap the `<div className="flex flex-col justify-center gap-2">` holding the "Add a player" / "Remove a player" buttons in `{onlinePort === null ? ( … ) : null}`.

(j) Replace the Ready `SkewButton` with:

```tsx
            <SkewButton
              onClick={startMatch}
              disabled={!canStart}
              aria-disabled={!canStart}
              className={cn(
                "border-[4px] border-panel-ink px-8 py-4 shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform",
                canStart ? "bg-smash-yellow text-panel-ink hover:-translate-y-1" : "bg-[#2a2d33] text-white/30",
              )}
              innerClassName="font-display text-xl leading-none tracking-[0.16em] uppercase sm:text-2xl"
            >
              {onlineRole === "guest" ? "Waiting for Host" : "Ready to Fight"}
            </SkewButton>
```

(k) `PlayerPanel`: add `online = false,` and `local = false,` to the destructured props and `online?: boolean;` / `local?: boolean;` to its prop type; wrap the `<div className="flex items-stretch px-4 pb-2">` (the two `KindTab`s) in `{online ? null : ( … )}`; replace `{isCpu ? "Computer" : "Human"}` with `{isCpu ? "Computer" : online ? (local ? "You" : "Opponent") : "Human"}`.

`src/components/menu/StageSelect.tsx`: add after the matchConfig import

```ts
import { leaveOnline, sendLobby, useOnlineStore } from "@/lib/onlineStore";
```

after `const cycleStageForm = useMatchConfig((s) => s.cycleStageForm);` add `const onlineRole = useOnlineStore((s) => s.role);`; replace `onBack={() => router.push("/rules")}` and `backLabel="Back to rules"` with

```tsx
        onBack={() => {
          // Online, the rules screen belongs to the local flow; going back is leaving the room.
          if (onlineRole) {
            leaveOnline();
            router.push("/online");
          } else {
            router.push("/rules");
          }
        }}
        backLabel={onlineRole ? "Leave the room" : "Back to rules"}
```

and replace the "Choose Fighters" button's `onClick={() => router.push("/fighters")}` with

```tsx
            onClick={() => {
              // The guest waits on character select; this is how it learns the stage.
              if (onlineRole === "host") sendLobby({ kind: "stage", stageId, form: stageForm });
              router.push("/fighters");
            }}
```

- [ ] **Step 4: Run the tests again (online and the existing local ones)**

Run: `pnpm vitest run src/components/menu`
Expected: PASS (all menu tests, including the unchanged local `CharacterSelect.test.tsx`).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/components/menu/CharacterSelect.tsx super-smash/src/components/menu/CharacterSelect.online.test.tsx super-smash/src/components/menu/StageSelect.tsx super-smash/src/components/menu/StageSelect.test.tsx
git commit -m "super-smash: stage and character select play online — one panel each, the host picks the stage and starts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Play online: link monitor, ping/delay/rollbacks HUD, "Connection lost", gamepads

**Files:**
- Create: `super-smash/src/game/linkMonitor.ts`, `super-smash/src/game/linkMonitor.test.ts`, `super-smash/src/components/match/NetHud.tsx`, `super-smash/src/components/match/NetHud.test.tsx`
- Modify (rewrite): `super-smash/src/app/play/page.tsx` (all 368 lines)

**Interfaces:**
- Consumes: `ConnectionWatchdog`, `LinkHealth` (Task 11); `OnlineSessionLike`, `getActiveSession` (Task 13); `Transport` (`src/net/transport.ts:22`); `NetStats` (`src/net/rollback.ts:181`); `NetplayOptions`, `createMatchRunner` (Task 17); `createGamepadInput`, `padPortMap` (Task 16, `src/input/gamepad.ts:302`); `runnerSlotsFor` (Task 12); `leaveOnline`, `useOnlineStore` (Task 14); `MatchResult` (Task 14).
- Produces:
```ts
// src/game/linkMonitor.ts
export const LINK_CHECK_MS = 250;
export interface VisibilitySource { readonly hidden: boolean; addEventListener(type: "visibilitychange", cb: () => void): void; removeEventListener(type: "visibilitychange", cb: () => void): void }
export interface LinkMonitorOptions {
  readonly transport: Pick<Transport, "onMessage" | "onPeerLeave">;
  readonly session: Pick<OnlineSessionLike, "on" | "sendLobby">;
  readonly onHealth: (health: LinkHealth, peerAway: boolean) => void;
  readonly onLost: () => void;
  readonly now?: () => number;
  readonly visibility?: VisibilitySource | null;
  readonly every?: (cb: () => void, ms: number) => () => void;
}
export function startLinkMonitor(options: LinkMonitorOptions): () => void;
// src/components/match/NetHud.tsx
export interface NetHudProps { readonly stats: Pick<NetStats, "rttMs" | "inputDelay" | "rollbacks"> | null; readonly health: LinkHealth; readonly peerAway: boolean }
export function NetHud(props: NetHudProps): JSX.Element;
// window.__smashNet (e2e): { stats(): NetStats | null; localPort: number; turn: boolean }
```

- [ ] **Step 1: Write the failing tests** — `src/game/linkMonitor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { LobbyMessage } from "@/net/online/lobby";
import type { SessionEvent } from "@/net/online/session";
import { AWAY_LOST_MS, SILENCE_LOST_MS, type LinkHealth } from "@/net/online/watchdog";
import { createEmitter } from "@/net/transport";
import { LINK_CHECK_MS, startLinkMonitor } from "./linkMonitor";

function harness() {
  let clock = 0;
  const ticks: (() => void)[] = [];
  const messages = createEmitter<[Uint8Array, string]>();
  const leaves = createEmitter<[string]>();
  const sessionEvents = createEmitter<[SessionEvent]>();
  const sent: LobbyMessage[] = [];
  const health: [LinkHealth, boolean][] = [];
  const onLost = vi.fn();
  const listeners: (() => void)[] = [];
  const visibility = {
    hidden: false,
    addEventListener: (_type: "visibilitychange", cb: () => void) => {
      listeners.push(cb);
    },
    removeEventListener: (_type: "visibilitychange", cb: () => void) => {
      listeners.splice(listeners.indexOf(cb), 1);
    },
  };
  const stop = startLinkMonitor({
    transport: { onMessage: (cb) => messages.add(cb), onPeerLeave: (cb) => leaves.add(cb) },
    session: {
      on: (cb) => sessionEvents.add(cb),
      sendLobby: (message) => {
        sent.push(message);
      },
    },
    onHealth: (h, away) => health.push([h, away]),
    onLost,
    now: () => clock,
    visibility,
    every: (cb, ms) => {
      expect(ms).toBe(LINK_CHECK_MS);
      ticks.push(cb);
      return () => {
        ticks.length = 0;
      };
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const tick of [...ticks]) tick();
  };
  return { advance, messages, leaves, sessionEvents, sent, health, onLost, visibility, listeners, ticks, stop };
}

describe("the online link monitor", () => {
  it("reports ok once and then stays quiet while packets flow", () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
      h.messages.emit(new Uint8Array([1]), "g1");
      h.advance(200);
    }
    expect(h.health).toEqual([["ok", false]]);
    expect(h.onLost).not.toHaveBeenCalled();
  });

  it("shows waiting after a second, then gives up after ten silent seconds", () => {
    const h = harness();
    h.advance(1_000);
    expect(h.health.at(-1)).toEqual(["waiting", false]);
    h.advance(SILENCE_LOST_MS);
    expect(h.onLost).toHaveBeenCalledTimes(1);
    h.advance(1_000);
    expect(h.onLost).toHaveBeenCalledTimes(1);
  });

  it("a backgrounded opponent gets a minute, not ten seconds", () => {
    const h = harness();
    h.sessionEvents.emit({ type: "lobby", message: { kind: "away", away: true } });
    expect(h.health.at(-1)).toEqual(["waiting", true]);
    h.advance(30_000);
    expect(h.onLost).not.toHaveBeenCalled();
    h.advance(AWAY_LOST_MS);
    expect(h.onLost).toHaveBeenCalledTimes(1);
  });

  it("treats the data channel closing as lost at once", () => {
    const h = harness();
    h.leaves.emit("g1");
    expect(h.onLost).toHaveBeenCalledTimes(1);
    expect(h.ticks).toHaveLength(0);
  });

  it("tells the opponent when this tab is hidden and when it is back", () => {
    const h = harness();
    h.visibility.hidden = true;
    for (const cb of [...h.listeners]) cb();
    h.visibility.hidden = false;
    for (const cb of [...h.listeners]) cb();
    expect(h.sent).toEqual([
      { kind: "away", away: true },
      { kind: "away", away: false },
    ]);
  });

  it("lets go of everything on stop", () => {
    const h = harness();
    h.stop();
    expect(h.listeners).toHaveLength(0);
    expect(h.ticks).toHaveLength(0);
    h.leaves.emit("g1");
    expect(h.onLost).not.toHaveBeenCalled();
  });
});
```

`src/components/match/NetHud.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { NetHud } from "./NetHud";

const STATS = { rttMs: 41.6, inputDelay: 3, rollbacks: 12 };

describe("NetHud", () => {
  it("shows ping, input delay and rollbacks", () => {
    render(<NetHud stats={STATS} health="ok" peerAway={false} />);
    expect(screen.getByText("PING 42 ms · DELAY 3f · ROLLBACKS 12")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says it is waiting when the opponent goes quiet", () => {
    render(<NetHud stats={STATS} health="waiting" peerAway={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for opponent…");
  });

  it("says why when the opponent switched tabs", () => {
    render(<NetHud stats={STATS} health="waiting" peerAway />);
    expect(screen.getByRole("status")).toHaveTextContent("Opponent switched tabs…");
  });

  it("shows nothing numeric before the first stats arrive", () => {
    render(<NetHud stats={null} health="ok" peerAway={false} />);
    expect(screen.queryByText(/PING/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/game/linkMonitor.test.ts src/components/match/NetHud.test.tsx`
Expected: FAIL — `Failed to resolve import "./linkMonitor"` / `"./NetHud"`.

- [ ] **Step 3: Implement** — `src/game/linkMonitor.ts`:

```ts
/**
 * Whether the other player is still there, during an online match.
 *
 * Three signals, one verdict. The data channel closing is final. Silence is
 * judged by the watchdog (net/online/watchdog.ts). And a tab going to the
 * background tells the opponent first — through the room, which a hidden tab
 * can still reach — so their watchdog waits a minute instead of ten seconds.
 */

import type { OnlineSessionLike } from "@/net/online/session";
import { ConnectionWatchdog, type LinkHealth } from "@/net/online/watchdog";
import type { Transport } from "@/net/transport";

export const LINK_CHECK_MS = 250;

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
}

export interface LinkMonitorOptions {
  readonly transport: Pick<Transport, "onMessage" | "onPeerLeave">;
  readonly session: Pick<OnlineSessionLike, "on" | "sendLobby">;
  readonly onHealth: (health: LinkHealth, peerAway: boolean) => void;
  readonly onLost: () => void;
  readonly now?: () => number;
  /** Defaults to `document`; null for none. */
  readonly visibility?: VisibilitySource | null;
  readonly every?: (cb: () => void, ms: number) => () => void;
}

export function startLinkMonitor(options: LinkMonitorOptions): () => void {
  const now = options.now ?? (() => performance.now());
  const every =
    options.every ??
    ((cb: () => void, ms: number) => {
      const id = window.setInterval(cb, ms);
      return () => window.clearInterval(id);
    });
  const visibility =
    options.visibility === undefined
      ? typeof document === "undefined"
        ? null
        : // One cast at the boundary: Document's overloaded listener types are wider than this slice.
          (document as unknown as VisibilitySource)
      : options.visibility;

  const dog = new ConnectionWatchdog(now());
  let lost = false;
  let stopped = false;
  let lastHealth: LinkHealth | null = null;
  let lastAway = false;

  const declareLost = () => {
    if (lost || stopped) return;
    lost = true;
    stop();
    options.onLost();
  };

  const report = () => {
    if (stopped) return;
    const health = dog.check(now());
    if (health === "lost") {
      declareLost();
      return;
    }
    if (health !== lastHealth || dog.peerAway !== lastAway) {
      lastHealth = health;
      lastAway = dog.peerAway;
      options.onHealth(health, dog.peerAway);
    }
  };

  const onVisibility = () => {
    if (visibility) options.session.sendLobby({ kind: "away", away: visibility.hidden });
  };

  const offs = [
    options.transport.onMessage(() => dog.heard(now())),
    options.transport.onPeerLeave(() => declareLost()),
    options.session.on((event) => {
      if (event.type === "lobby" && event.message.kind === "away") {
        dog.setPeerAway(event.message.away, now());
        report();
      }
    }),
  ];
  visibility?.addEventListener("visibilitychange", onVisibility);
  const cancel = every(report, LINK_CHECK_MS);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancel();
    for (const off of offs) off();
    visibility?.removeEventListener("visibilitychange", onVisibility);
  }

  return stop;
}
```

`src/components/match/NetHud.tsx`:

```tsx
import type { LinkHealth } from "@/net/online/watchdog";
import type { NetStats } from "@/net/rollback";

export interface NetHudProps {
  readonly stats: Pick<NetStats, "rttMs" | "inputDelay" | "rollbacks"> | null;
  readonly health: LinkHealth;
  readonly peerAway: boolean;
}

/**
 * The three numbers that say how an online match is going, in a corner.
 *
 * Ping is the measured round trip; delay is the frames of input lag the
 * session chose from it (1–8, auto-tuned); rollbacks count the corrections
 * prediction needed. Below them, a line only when the opponent has gone quiet.
 */
export function NetHud({ stats, health, peerAway }: NetHudProps) {
  return (
    <div
      aria-label="Connection"
      className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1 font-menu text-xs font-bold text-white/85"
    >
      {stats ? (
        <p className="rounded bg-black/55 px-2 py-1 tabular-nums">
          {`PING ${Math.round(stats.rttMs)} ms · DELAY ${stats.inputDelay}f · ROLLBACKS ${stats.rollbacks}`}
        </p>
      ) : null}
      {health === "ok" ? null : (
        <p role="status" className="rounded bg-smash-red px-2 py-1 text-white">
          {peerAway ? "Opponent switched tabs…" : "Waiting for opponent…"}
        </p>
      )}
    </div>
  );
}
```

`src/app/play/page.tsx` — replace the whole file with:

```tsx
"use client";

/**
 * The match itself.
 *
 * A canvas, a loop, and as little React as possible. Everything that changes at
 * 60Hz lives inside `createMatchRunner` and is painted directly; React is only
 * responsible for the things that change once a match — the countdown, the
 * pause overlay, the hand-off to the results screen. Re-rendering a component
 * tree sixty times a second to move a fighter would be the single easiest way
 * to lose frames here, so the game state deliberately never enters React state.
 *
 * Two ways in. Locally, the match is whatever the menus put in the match
 * config. Online, it is the host's start config, played through the active
 * session's transport with a rollback session; that is decided once, at
 * mount, because leaving an online match resets the very stores a local match
 * would otherwise restart from.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MatchOutcome, MatchRules, StageDef } from "@/engine/types";
import { toFloat } from "@/engine/fixed";
import {
  createMatchRunner,
  type MatchRunner,
  type NetplayOptions,
  type PlayerSlot as RunnerSlot,
} from "@/game/matchRunner";
import { bootstrapEngine, getFighterOrThrow, resolveFighterId, resolveMatchStage, schemeForMenuId } from "@/game/bootstrap";
import { startLinkMonitor } from "@/game/linkMonitor";
import { runnerSlotsFor } from "@/game/onlineConfig";
import { createKeyboardInput, type KeyboardInput } from "@/input/keyboard";
import { createGamepadInput, padPortMap, type GamepadInput } from "@/input/gamepad";
import { AudioEngine } from "@/audio";
import { conflictFreeSelection } from "@/input/schemes";
import { useMatchConfig, type MatchResult, type PlayerResultStat, type PlayerSlot } from "@/lib/matchConfig";
import { leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import { NetHud } from "@/components/match/NetHud";
import type { OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, type OnlineSessionLike } from "@/net/online/session";
import type { LinkHealth } from "@/net/online/watchdog";
import type { NetStats } from "@/net/rollback";
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from "@/render/renderer";
import { worldToScreen } from "@/render/camera";

/**
 * Who gets credit for a kill.
 *
 * `StepEvents.kos` reports who died, not who did it — the simulation has no
 * reason to care, since a stock is a stock. The results screen does care, so
 * the attribution is done here, in the presentation layer, the way the real
 * game does it: whoever last landed a hit on you owns your death, and if nobody
 * has touched you recently, you walked off the stage yourself.
 *
 * Three seconds, because that is Ultimate's own rule — a KO only counts as a
 * self-destruct if no opponent has hit you within the last three minutes of
 * game time in their scoring, but for a single stock the practical window that
 * feels right is much shorter. Anything longer and a fighter who was hit once
 * at the start of the stock and then dived into the blast zone reads as a kill.
 */
const KILL_CREDIT_FRAMES = 180;

interface StatTracker {
  readonly kos: number[];
  readonly falls: number[];
  readonly sds: number[];
  readonly lastHitBy: number[];
  readonly lastHitFrame: number[];
}

function createTracker(count: number): StatTracker {
  return {
    kos: new Array(count).fill(0),
    falls: new Array(count).fill(0),
    sds: new Array(count).fill(0),
    lastHitBy: new Array(count).fill(-1),
    lastHitFrame: new Array(count).fill(-99999),
  };
}

function toRunnerSlots(players: readonly PlayerSlot[], seed: number): RunnerSlot[] {
  return players.map((p) => ({
    selection: {
      defId: resolveFighterId(p.fighterId, seed, p.port),
      costume: p.costume,
    },
    cpuLevel: p.kind === "cpu" ? p.cpuLevel : null,
    label: p.kind === "cpu" ? `CPU` : `P${p.port + 1}`,
  }));
}

/** Everything an online match needs, captured once when the page mounts. */
interface OnlineMount {
  readonly config: OnlineMatchConfig;
  readonly session: OnlineSessionLike;
  readonly localPort: number;
}

function onlineAtMount(): OnlineMount | null {
  const config = useOnlineStore.getState().config;
  const session = getActiveSession();
  const localPort = session?.localPort ?? null;
  return config && session && localPort !== null ? { config, session, localPort } : null;
}

interface MountArgs {
  readonly canvas: HTMLCanvasElement;
  readonly slots: RunnerSlot[];
  readonly ports: readonly number[];
  readonly stage: StageDef;
  readonly rules: MatchRules;
  readonly seed: number;
  readonly keyboard: KeyboardInput | null;
  readonly gamepad: GamepadInput | null;
  readonly net: NetplayOptions | null;
  readonly onResult: (result: MatchResult) => void;
}

interface Mounted {
  readonly runner: MatchRunner;
  dispose(): void;
}

/**
 * The runner and everything that hangs off it — sound, kill credit, the e2e
 * debug handles — built the same way for a local and an online match.
 */
function mountMatch(args: MountArgs): Mounted {
  const { canvas, slots, ports } = args;

  // Every sound in the game is synthesised on demand, so there is nothing
  // to preload and no reason to build the context before it can be heard.
  // Autoplay policy suspends an AudioContext created outside a gesture, and
  // arriving here from the character-select screen means the player has
  // already clicked — but a deep link or a reload has not, so the unlock
  // stays armed until the first key or click either way.
  //
  // Wrapped separately from the match: a browser with no Web Audio, or one
  // that refuses to build a context, should cost the player their sound and
  // nothing else.
  let audio: AudioEngine | null = null;
  let releaseAudioGesture: (() => void) | null = null;
  try {
    audio = new AudioEngine();
    releaseAudioGesture = audio.unlockOnGesture();
    void audio.resume().catch(() => {});
  } catch {
    audio = null;
  }

  const tracker = createTracker(slots.length);
  const runner = createMatchRunner({
    stage: args.stage,
    players: slots,
    rules: args.rules,
    seed: args.seed,
    getFighter: getFighterOrThrow,
    keyboard: args.keyboard,
    gamepad: args.gamepad,
    net: args.net,
    audio,
    onFrame: (state, events) => {
      // The canvas is opaque to an end-to-end test, so the frame counter is
      // published deliberately: it is the one honest signal that the
      // simulation is advancing.
      (window as unknown as { __smashFrame?: number }).__smashFrame = state.frame;

      for (const hit of events.hits) {
        if (hit.attacker === hit.victim) continue;
        tracker.lastHitBy[hit.victim] = hit.attacker;
        tracker.lastHitFrame[hit.victim] = state.frame;
      }
      for (const ko of events.kos) {
        tracker.falls[ko.port] += 1;
        const killer = tracker.lastHitBy[ko.port];
        const recent = state.frame - tracker.lastHitFrame[ko.port] <= KILL_CREDIT_FRAMES;
        if (killer >= 0 && recent) tracker.kos[killer] += 1;
        else tracker.sds[ko.port] += 1;
        tracker.lastHitBy[ko.port] = -1;
      }
    },
    onEnd: (outcome: MatchOutcome) => {
      const stats: PlayerResultStat[] = ports.map((port) => ({
        port,
        kos: tracker.kos[port] ?? 0,
        falls: tracker.falls[port] ?? 0,
        sds: tracker.sds[port] ?? 0,
      }));
      args.onResult({
        kind: outcome.kind,
        placings: outcome.placings,
        stats,
        fighters: Object.fromEntries(slots.map((s, i) => [ports[i], s.selection.defId])),
        ...(args.net ? { online: true } : {}),
      });
    },
  });

  // How an end-to-end test sees the simulation. Accessors rather than a
  // per-frame snapshot: publishing a fresh object 60 times a second would put
  // real garbage on the hot loop to serve a test that reads it twice.
  (window as unknown as { __smashDebug?: unknown }).__smashDebug = {
    get frame() {
      return runner.frame;
    },
    get stageId() {
      return runner.state.stageId;
    },
    // Hand-cranking the loop, for looking at a single frame (D46).
    pause: () => runner.stop(),
    resume: () => runner.start(canvas),
    step: (n = 1) => runner.advance(n),
    screenPositions: () =>
      runner.state.fighters.map((f) => {
        const p = worldToScreen(runner.camera, toFloat(f.x), toFloat(f.y));
        return { port: f.port, x: p.x / INTERNAL_WIDTH, y: p.y / INTERNAL_HEIGHT };
      }),
    moveFrames: () =>
      runner.state.fighters.map((f) => {
        const def = f.move ? getFighterOrThrow(f.defId) : null;
        return { port: f.port, move: f.move, total: (f.move && def?.moves[f.move]?.totalFrames) ?? 0 };
      }),
    fighters: () =>
      runner.state.fighters.map((f) => ({
        port: f.port,
        x: toFloat(f.x),
        y: toFloat(f.y),
        action: f.action,
        actionFrame: f.actionFrame,
        move: f.move,
        damage: toFloat(f.damage),
        stocks: f.stocks,
        facing: f.facing,
        intangible: f.intangible,
        hitstun: f.hitstun,
      })),
  };

  const mounted: Mounted = {
    runner,
    dispose() {
      runner.dispose();
      releaseAudioGesture?.();
      // Disposed, not just silenced: browsers cap how many AudioContexts a
      // page may hold, and leaking one per match eventually mutes the game.
      audio?.dispose();
      delete (window as unknown as { __smashDebug?: unknown }).__smashDebug;
    },
  };
  try {
    runner.start(canvas);
  } catch (e) {
    mounted.dispose();
    throw e;
  }
  return mounted;
}

export default function PlayPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<MatchRunner | null>(null);
  const keyboardRef = useRef<KeyboardInput | null>(null);

  const players = useMatchConfig((s) => s.players);
  const stageId = useMatchConfig((s) => s.stageId);
  const stageForm = useMatchConfig((s) => s.stageForm);
  const rules = useMatchConfig((s) => s.rules);
  const bindings = useMatchConfig((s) => s.bindings);
  const setResult = useMatchConfig((s) => s.setResult);

  const [online] = useState(onlineAtMount);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [netStats, setNetStats] = useState<NetStats | null>(null);
  const [linkHealth, setLinkHealth] = useState<LinkHealth>("ok");
  const [peerAway, setPeerAway] = useState(false);

  const quit = useCallback(() => {
    runnerRef.current?.dispose();
    keyboardRef.current?.detach();
    router.push("/menu");
    if (online) leaveOnline();
  }, [online, router]);

  /* ------------------------------------------------------------ local match -- */

  useEffect(() => {
    if (online) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mounted: Mounted | null = null;
    let keyboard: KeyboardInput | null = null;
    let gamepad: GamepadInput | null = null;

    try {
      bootstrapEngine();
      // A fixed seed per mount rather than a random one: the whole simulation is
      // reproducible from it, which is what makes a desync report actionable.
      const seed = 0x5eed1e55;
      // Random is a menu token, not a stage. Resolve it — and fold in the form —
      // before the engine ever sees the id, or it throws `Unknown stage "random"`.
      const stage = resolveMatchStage(stageId, stageForm, (seed ^ ((Math.random() * 0x7fffffff) | 0)) | 0);
      const slots = toRunnerSlots(players, seed);

      const humans = players.filter((p) => p.kind === "human");
      if (humans.length > 0) {
        // `conflictFreeSelection` stops two people picking mirror-image presets
        // that share physical keys (DECISIONS D8), with the player's own
        // rebinding applied (D33). Paired back to owners by membership, not by
        // index: it drops rejected entries.
        const requested = humans.map((p) => ({
          port: p.port,
          scheme: schemeForMenuId(p.scheme, bindings[p.scheme]),
        }));
        const chosen = conflictFreeSelection(requested.map((r) => r.scheme));
        const kept = new Set(chosen.active);
        keyboard = createKeyboardInput(requested.filter((r) => kept.has(r.scheme)));
        // Constructing the reader binds no listeners; without this, `drain()`
        // truthfully reports "nothing held" forever (D29).
        keyboard.attach();
        keyboardRef.current = keyboard;
        // One pad per human, in port order: pad 0 is the first human.
        gamepad = createGamepadInput({ portForPad: padPortMap(humans.map((p) => p.port)) });
        gamepad.attach();
      }

      mounted = mountMatch({
        canvas,
        slots,
        ports: players.map((p) => p.port),
        stage,
        rules,
        seed,
        keyboard,
        gamepad,
        net: null,
        onResult: (result) => {
          setResult(result);
          // Let the KO play out before cutting away.
          window.setTimeout(() => router.push("/results"), 2400);
        },
      });
      runnerRef.current = mounted.runner;
    } catch (e) {
      // Deferred out of the effect body: setting state synchronously here
      // cascades a second render before the first has committed.
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(message));
    }

    return () => {
      mounted?.dispose();
      keyboard?.detach();
      gamepad?.detach();
      runnerRef.current = null;
      keyboardRef.current = null;
    };
  }, [online, players, stageId, stageForm, rules, bindings, router, setResult]);

  /* ----------------------------------------------------------- online match -- */

  useEffect(() => {
    if (!online) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { config, session, localPort } = online;

    let mounted: Mounted | null = null;
    let stopMonitor: (() => void) | null = null;
    let statsTimer = 0;
    let finished = false;
    // Each player is on their own machine, so each gets Config 1 (with their
    // own rebinding) and every pad, on their own port.
    const keyboard = createKeyboardInput([{ port: localPort, scheme: schemeForMenuId("arrows", bindings.arrows) }]);
    const gamepad = createGamepadInput({ portForPad: () => localPort });

    const finish = (result: MatchResult, delayMs: number) => {
      if (finished) return;
      finished = true;
      stopMonitor?.();
      setResult(result);
      window.setTimeout(() => {
        // Close the room and clear the online stores now, so nothing — the
        // lobby, the select screens — finds a "connected" room afterwards.
        // `leaveOnline` keeps the result just recorded (Task 14).
        leaveOnline();
        router.push("/results");
      }, delayMs);
    };

    try {
      bootstrapEngine();
      keyboard.attach();
      keyboardRef.current = keyboard;
      gamepad.attach();
      mounted = mountMatch({
        canvas,
        slots: runnerSlotsFor(config),
        ports: [0, 1],
        stage: resolveMatchStage(config.stageId, config.stageForm, config.seed),
        rules: config.rules,
        seed: config.seed,
        keyboard,
        gamepad,
        net: {
          transport: session.transport,
          localPorts: [localPort],
          onDesync: (report) => console.warn("David-Smash: desync", report),
        },
        onResult: (result) => finish(result, 2400),
      });
      const runner = mounted.runner;
      runnerRef.current = runner;
      stopMonitor = startLinkMonitor({
        transport: session.transport,
        session,
        onHealth: (health, away) => {
          setLinkHealth(health);
          setPeerAway(away);
        },
        onLost: () => {
          runner.stop();
          finish(
            {
              kind: "connectionLost",
              placings: [],
              stats: [],
              fighters: { 0: config.fighters[0], 1: config.fighters[1] },
              online: true,
            },
            0,
          );
        },
      });
      statsTimer = window.setInterval(() => setNetStats(runner.netStats), 250);
      (window as unknown as { __smashNet?: unknown }).__smashNet = {
        stats: () => runner.netStats,
        localPort,
        turn: session.turn,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(message));
    }

    return () => {
      window.clearInterval(statsTimer);
      stopMonitor?.();
      mounted?.dispose();
      keyboard.detach();
      gamepad.detach();
      runnerRef.current = null;
      keyboardRef.current = null;
      delete (window as unknown as { __smashNet?: unknown }).__smashNet;
    };
  }, [online, bindings, router, setResult]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Escape") return;
      setPaused((p) => {
        const next = !p;
        // An online match cannot pause — the other player's game would stall
        // behind this one — so Esc only brings up the way out.
        if (!online) {
          const canvas = canvasRef.current;
          if (next) runnerRef.current?.stop();
          else if (canvas) runnerRef.current?.start(canvas);
        }
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [online]);

  return (
    <main className="relative flex h-dvh w-full items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        width={INTERNAL_WIDTH}
        height={INTERNAL_HEIGHT}
        aria-label="Match"
        className="h-full w-full"
      />

      {online && !error ? <NetHud stats={netStats} health={linkHealth} peerAway={peerAway} /> : null}

      {error && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-8 text-center"
        >
          <p className="font-display text-3xl text-smash-yellow">THE MATCH COULD NOT START</p>
          <p className="max-w-lg font-menu text-sm text-white/80">{error}</p>
          <button
            onClick={quit}
            className="mt-2 skew-x-[-12deg] bg-smash-red px-6 py-2 font-display text-xl text-white"
          >
            <span className="inline-block skew-x-[12deg]">BACK TO MENU</span>
          </button>
        </div>
      )}

      {paused && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70">
          <p className="font-display text-5xl tracking-widest text-white">{online ? "MENU" : "PAUSED"}</p>
          <p className="font-menu text-sm text-white/70">
            {online ? "The match keeps running · Esc to return" : "Esc to resume"}
          </p>
          <button
            onClick={quit}
            className="skew-x-[-12deg] bg-smash-red px-6 py-2 font-display text-xl text-white"
          >
            <span className="inline-block skew-x-[12deg]">{online ? "LEAVE MATCH" : "QUIT MATCH"}</span>
          </button>
        </div>
      )}
    </main>
  );
}
```

Known limitation, recorded in D54 (Task 23): online, KO/fall/SD credit on the results screen is counted from the events of each frame as first shown. A rollback that later changes who landed a hit or whether a KO happened can misattribute one of those stats. The placings come from the confirmed final state (`isFinal`, Task 17) and are always right. Fixing it properly needs the session to report events for confirmed frames, which `RollbackSession` does not expose today — a follow-up, not part of this plan.

- [ ] **Step 4: Run the tests again**

Run: `pnpm vitest run src/game/linkMonitor.test.ts src/components/match/NetHud.test.tsx`
Expected: PASS (6 + 4 tests).

- [ ] **Step 5: Full gate, plus the local e2e (the play page is only reachable from a browser)**

Run: `pnpm typecheck && pnpm lint && pnpm test && PORT=3107 pnpm test:e2e`
Expected: exit 0 — every existing gameplay, rebinding, controls and flow spec still drives a local match through the rewritten page (the "PAUSED" overlay text is unchanged for local play).

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/game/linkMonitor.ts super-smash/src/game/linkMonitor.test.ts super-smash/src/components/match/NetHud.tsx super-smash/src/components/match/NetHud.test.tsx super-smash/src/app/play/page.tsx
git commit -m "super-smash: play online — rollback over the room's DataChannel, a ping/delay/rollbacks HUD, and Connection Lost" -m "The play page decides at mount whether it is online. Online it plays the host's config through the active session with a link monitor (10 s silence, 60 s for a backgrounded opponent, channel close at once); Esc never pauses an online match. Gamepads are wired into local and online matches." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 22: Two browsers, one room: the online e2e (local `wrangler dev` or the public URL)

**Files:**
- Create: `super-smash/playwright.online.config.ts`, `super-smash/e2e-online/online.spec.ts`
- Modify: `super-smash/playwright.config.ts:14-15,58-63` (`SMASH_URL`), `super-smash/package.json` (script `test:e2e:online`)

**Interfaces:**
- Consumes: `ROUTES`, `readFighters` (`e2e/helpers.ts:11,79`); `window.__smashDebug.frame` (Task 21 `mountMatch`); `window.__smashNet.stats()` (Task 21); `data-testid="room-code"`, label "Room code", buttons "Create room"/"Join room" (Task 19); "Waiting for Host" (Task 20); "Connection Lost" (Task 18).
- Produces: `pnpm test:e2e:online` (local: builds and runs `wrangler dev` on :8787); `SMASH_URL=<url> pnpm test:e2e:online` (public); `SMASH_FORCE_RELAY=1` forces TURN via `/online?ice=relay`; `SMASH_URL=<url> pnpm test:e2e` runs the whole existing suite against the public site.

This is the acceptance test for Tasks 7–21. It should pass on its first run; a failure is a bug in one of those tasks — debug it there (superpowers:systematic-debugging) rather than loosening this spec.

- [ ] **Step 1: Let the existing suite target the public site** — in `playwright.config.ts` replace

```ts
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;
```

with

```ts
const PORT = Number(process.env.PORT ?? 3000);
/** Set to run the whole suite against a deployed copy instead of `next dev` (Plan 1, Task 24). */
const PUBLIC_URL = process.env.SMASH_URL;
const BASE_URL = PUBLIC_URL ?? `http://localhost:${PORT}`;
```

and replace the `webServer: { … },` object (whose command Task 2 changed to `pnpm exec next dev`) with

```ts
  webServer: PUBLIC_URL
    ? undefined
    : {
        command: `pnpm exec next dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
```

- [ ] **Step 2: Write the online config** — `playwright.online.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

/**
 * The online suite: two (or three) browser contexts in one room.
 *
 * It needs the Worker, not `next dev` — rooms and /api/ice live there — so it
 * builds the static export and serves it with `wrangler dev`, or, with
 * SMASH_URL set, runs against the deployed site.
 *
 * Chromium hides host ICE candidates behind mDNS names by default; two
 * contexts on one machine connect faster and more reliably with real ones.
 */
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.SMASH_URL;
const BASE_URL = PUBLIC_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e-online",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
      },
    },
  ],
  webServer: PUBLIC_URL
    ? undefined
    : {
        command: `pnpm run build && WRANGLER_SEND_METRICS=false pnpm exec wrangler dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 300_000,
      },
});
```

In `package.json` scripts add `"test:e2e:online": "playwright test -c playwright.online.config.ts",`.

- [ ] **Step 3: Write the spec** — `e2e-online/online.spec.ts`:

```ts
import { expect, test, type Browser, type Page } from "@playwright/test";

import { ROUTES, readFighters } from "../e2e/helpers";

/**
 * Two browsers, one room, one match — the whole online path end to end.
 *
 * Locally this runs against `wrangler dev`; with SMASH_URL it runs against the
 * deployed Worker, and SMASH_FORCE_RELAY=1 forces both peers through
 * Cloudflare TURN, which is how the deploy proves the relay works rather than
 * merely exists.
 */
const LOBBY = process.env.SMASH_FORCE_RELAY === "1" ? "/online?ice=relay" : "/online";

interface NetHandle {
  stats(): { peers: number; desyncs: number } | null;
}

async function player(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function frame(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __smashDebug?: { frame: number } }).__smashDebug?.frame ?? -1);
}

async function netStats(page: Page) {
  return page.evaluate(() => (window as unknown as { __smashNet?: NetHandle }).__smashNet?.stats() ?? null);
}

async function createRoom(host: Page): Promise<string> {
  await host.goto(LOBBY);
  await host.getByRole("button", { name: /create room/i }).click();
  const box = host.getByTestId("room-code");
  await expect(box).toHaveText(/^[A-Z]{4}$/, { timeout: 15_000 });
  return (await box.textContent())!.trim();
}

async function joinRoom(page: Page, code: string): Promise<void> {
  await page.goto(LOBBY);
  // Typed the way people type a code they were read: in lowercase.
  await page.getByLabel("Room code").fill(code.toLowerCase());
  await page.getByRole("button", { name: /join room/i }).click();
}

test("two browsers play a match through a room, and one leaving ends it for the other", async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);

  const code = await createRoom(host);
  await joinRoom(guest, code);
  await host.waitForURL(`**${ROUTES.stage}`, { timeout: 30_000 });
  await guest.waitForURL(`**${ROUTES.fighters}`, { timeout: 30_000 });

  // exact: "Small Battlefield" also matches a substring query.
  await host.getByLabel("Stages").getByRole("button", { name: "Battlefield", exact: true }).click();
  await host.getByRole("button", { name: /choose fighters/i }).click();
  await host.waitForURL(`**${ROUTES.fighters}`);
  await expect(guest.getByText(/stage: battlefield/i)).toBeVisible();

  await host.getByLabel("Fighters").getByRole("button").nth(0).click();
  await guest.getByLabel("Fighters").getByRole("button").nth(5).click();
  await expect(guest.getByRole("button", { name: /waiting for host/i })).toBeDisabled();
  await host.getByRole("button", { name: /ready to fight/i }).click();

  await host.waitForURL(`**${ROUTES.play}`);
  await guest.waitForURL(`**${ROUTES.play}`);
  await expect.poll(() => frame(host), { timeout: 30_000 }).toBeGreaterThan(180);
  await expect.poll(() => frame(guest), { timeout: 30_000 }).toBeGreaterThan(180);

  for (const page of [host, guest]) {
    const stats = await netStats(page);
    expect(stats?.peers).toBe(1);
    expect(stats?.desyncs).toBe(0);
  }
  await expect(host.getByText(/^PING \d+ ms · DELAY \d+f · ROLLBACKS \d+$/)).toBeVisible();

  // The guest's key moves the guest's fighter on the host's screen.
  const before = (await readFighters(host))[1].x;
  await guest.bringToFront();
  await guest.keyboard.down("ArrowRight");
  await expect.poll(async () => (await readFighters(host))[1].x, { timeout: 10_000 }).toBeGreaterThan(before + 5);
  await guest.keyboard.up("ArrowRight");

  // The guest closes the tab: the host is told, and nobody is crowned.
  await guest.context().close();
  await host.waitForURL(`**${ROUTES.results}`, { timeout: 30_000 });
  await expect(host.getByText("Connection Lost")).toBeVisible();
});

test("a third browser is turned away from a full room", async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);
  const third = await player(browser);

  const code = await createRoom(host);
  await joinRoom(guest, code);
  await guest.waitForURL(`**${ROUTES.fighters}`, { timeout: 30_000 });

  await joinRoom(third, code);
  // filter: Next's route announcer is also role=alert.
  await expect(third.getByRole("alert").filter({ hasText: "already has two players" })).toHaveText(
    `Room ${code} already has two players.`,
  );
  await expect(host).toHaveURL(new RegExp(`${ROUTES.stage}$`));
});
```

- [ ] **Step 4: Run it locally**

Run: `pnpm test:e2e:online`
Expected: 2 passed (the first run builds `out/` and starts `wrangler dev`; allow ~2 minutes).

- [ ] **Step 5: Full gate and the existing e2e**

Run: `pnpm typecheck && pnpm lint && pnpm test && PORT=3107 pnpm test:e2e`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/playwright.config.ts super-smash/playwright.online.config.ts super-smash/e2e-online/online.spec.ts super-smash/package.json
git commit -m "super-smash: a two-browser online e2e against wrangler dev or the deployed Worker" -m "Create, join (typed lowercase), host picks the stage, both pick, the host starts; both peers advance with one peer and no desync, the guest's key moves the guest's fighter on the host's screen, closing the guest shows Connection Lost; a third browser is turned away. SMASH_URL targets the public site, SMASH_FORCE_RELAY=1 forces TURN." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: README, `.env.example`, D54, and the Replicates index

**Files:**
- Create: `super-smash/src/lib/envExample.test.ts`
- Modify: `super-smash/.env.example` (rewrite), `super-smash/README.md` (:1, :35, :53-70, :170-180, :214-224, :245-256, :259-262, :288), `super-smash/DECISIONS.md` (append D54), `README.md` (Replicates root, :172-196)
- Commit (until now untracked): the whole `super-smash/docs/superpowers/` folder (the spec, this plan and Plans 2–5) and the research it cites, `super-smash/research/rebuild-2026-10/` (README, `ssbu_fighter_params.csv` of published calculator numbers, `tools/*.mjs`). Planner's call (2026-10-24), confirmed when David approves this plan; none of it is a Nintendo asset.

**Interfaces:** none (documentation); the test pins `.env.example` to what the code reads.

- [ ] **Step 1: Write the failing test** — `src/lib/envExample.test.ts`:

```ts
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe(".env.example", () => {
  it("names only the two Worker secrets, which the Worker actually declares", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const names = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]).sort();
    expect(names).toEqual(["TURN_KEY_API_TOKEN", "TURN_KEY_ID"]);
    const env = readFileSync(join(ROOT, "worker", "src", "env.ts"), "utf8");
    for (const name of names) expect(env).toContain(name);
  });

  it("is right that the browser code reads no environment at all", () => {
    const offenders = sources(join(ROOT, "src")).filter((file) => readFileSync(file, "utf8").includes("process.env"));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/lib/envExample.test.ts`
Expected: FAIL — `expected [ 'NEXT_PUBLIC_INPUT_DELAY', 'NEXT_PUBLIC_ROOM_PREFIX', 'NEXT_PUBLIC_SIGNAL_STRATEGY' ] to deeply equal [ 'TURN_KEY_API_TOKEN', 'TURN_KEY_ID' ]` (the three stale variables were never read by any code).

- [ ] **Step 3: Write the docs** — replace `.env.example` with:

```bash
# David-Smash's browser code reads no environment variables. There is nothing
# to configure, no account to create and no key to obtain to play locally.
#
# The only settings live in the Cloudflare Worker (wrangler.jsonc), and two of
# them are secrets: the Cloudflare TURN key that lets players behind strict
# NATs connect. Without them the Worker hands out STUN only, which still covers
# LAN play and most home connections.
#
# Production — David sets them once, from this directory:
#   pnpm exec wrangler secret put TURN_KEY_ID
#   pnpm exec wrangler secret put TURN_KEY_API_TOKEN
#
# Local `pnpm preview` (wrangler dev) reads them from a git-ignored .dev.vars
# file next to this one, in this format:
# TURN_KEY_ID=
# TURN_KEY_API_TOKEN=
```

`README.md` (super-smash):
1. Line 1: `# Super Smash` → `# David-Smash`.
2. In the Index table, change the `src/net` row's description to `Rollback session, wire format, four transports, and the online lobby`, and add after it the row ``| [`worker`](worker) | The Cloudflare Worker: static assets, TURN credentials, and a Durable Object per room |``.
3. After the Quick start paragraph that ends "The whole game runs in the browser." add: ``Online play needs the Worker as well: `pnpm preview` builds the static export and serves it with the Worker on <http://localhost:8787>. Open it in two browsers, then Online → Create room in one and Join room in the other.``
4. In the command table, replace ``| `pnpm run build` | Production build |`` with ``| `pnpm run build` | Static export into `out/` |``, replace ``| `pnpm start` | Serve the production build |`` with ``| `pnpm preview` | Build, then serve `out/` with the Worker (rooms, TURN) on :8787 |``, and add the rows ``| `pnpm run test:e2e:online` | Two browsers play an online match against `wrangler dev` |`` and ``| `pnpm run deploy` | Build and `wrangler deploy` (David's Cloudflare login) |``.
5. In Controls, replace the paragraph starting "Walking is not reachable, and that is correct" with:

```markdown
On a keyboard, walking is not reachable, and that is correct rather than missing — a key is
always a *full* deflection, and a fully-deflected stick dashes. Micro-spacing comes from tapping.

**A gamepad works too**, in local and online matches (W3C standard mapping: A attack, B special,
X/Y jump, LB/LT/RT shield, RB grab; pad 1 is the first human, pad 2 the second). The analog
stick restores what keys cannot: a partial tilt walks, makes a tilt instead of a smash, and DIs a
quarter as far ([D54](DECISIONS.md#d54--david-smash-moves-to-cloudflare-and-gets-online-play)).
```

6. In Multiplayer, insert after its first paragraph:

```markdown
**Finding each other.** Online → Create room gives a four-letter code (no I or O); the other
player types it into Join room. The two browsers meet in a Durable Object on this project's own
Cloudflare Worker, which relays one WebRTC offer, one answer and their ICE candidates — and then
nothing: inputs go peer to peer over one unordered, unreliable DataChannel. The host picks the
stage and starts; ping, input delay and rollbacks show in the corner. Where no direct path
exists, Cloudflare TURN relays the same packets; without a TURN key the Worker hands out STUN
only. The Trystero (Nostr) adapter is still in `src/net/adapters/webrtc.ts`, selectable in code.
```

7. Replace the whole body of `## Deploying` (both paragraphs) with:

```markdown
David-Smash is a static export served by one Cloudflare Worker on the free plan:
**<https://david-smash.leaders-game.workers.dev>**.

| Piece | What it is |
|---|---|
| `out/` | `next build` with `output: "export"` — every route is a file |
| `wrangler.jsonc` | Worker `david-smash`: serves `out/`, runs first only for `/api/*` and `/ws/*` |
| `GET /api/ice` | Mints 4-hour Cloudflare TURN credentials; STUN-only without the two secrets |
| `/ws/room/:code` | A SQLite-backed Durable Object per room — WebSocket Hibernation, 2 peers, no timers |

`pnpm run deploy` builds and runs `wrangler deploy`; it needs `wrangler login` on David's
account, and the TURN secrets are set once with `wrangler secret put` (see `.env.example`). A
deploy restarts every room, which drops lobby sockets but not matches in progress — those are
peer to peer.
```

8. In Known gaps, replace item 1 ("**No TURN server.** …" and its continuation line) with:

```markdown
1. **Online is two players, one match at a time.** A room holds two peers; four-player online,
   spectating and an online rematch are not built — after a match both players go back through
   the lobby. KO/fall/SD credit on an online results screen can be off after a rollback that
   changed a hit; the placings are always right
   ([D54](DECISIONS.md#d54--david-smash-moves-to-cloudflare-and-gets-online-play)).
```
9. In "What this is", `**Super Smash** is a rebuild` → `**David-Smash** is a rebuild`.

`DECISIONS.md` — append:

```markdown
---

## D54 — David-Smash moves to Cloudflare, and gets online play

**Decision.** The product is called David-Smash wherever a player reads it; the directory and
both external slugs keep `super-smash`. It is a Next static export served by one free
Cloudflare Worker, `david-smash`, whose only dynamic parts are `GET /api/ice` (Cloudflare TURN
credentials, STUN-only without a key) and `/ws/room/:code` (one SQLite-backed Durable Object per
room, WebSocket Hibernation, two peers, no timers). A new transport, `adapters/doSignal.ts`,
implements the existing `Transport` port over one negotiated, unordered, zero-retransmit
DataChannel on stream 42; Trystero stays as an alternate. The Vercel copy is taken down.

**Why.** Vercel Hobby cannot host the signalling (Functions WebSockets close at 300 s and are
pinned to one instance), and Trystero's public Nostr relays come with no SLA and no TURN. One
free Cloudflare account carries the static site, the rooms and TURN (spec §4, research §5).

**What the room is not.** It never runs the game: a 60 Hz loop in a Durable Object would keep it
awake, and is the server-authoritative design this netcode exists to avoid. It relays an offer,
an answer and some ICE candidates, then idles until somebody leaves.

**Two details that are easy to get wrong.**
- *The data channel decides whether the peer is there, not the room socket.* Every Worker deploy
  restarts every Durable Object and drops its sockets; a match in progress must not end because
  of a deploy. `peer-left` from the room only matters before the channel opens.
- *A backgrounded tab is not a dead peer.* Browsers stop `requestAnimationFrame` in background
  tabs, so its packets stop. The tab says `away` through the room first, and the other side
  waits 60 s instead of 10.

**Gamepads** are wired into every match. `InputFrame` stays a bitfield (SPEC §3) with one new
bit, `Btn.Soft`, for a partial stick tilt: walk instead of dash, tilt instead of smash, a quarter
of the DI. The quarter is `UNVERIFIED:` — the bit carries one level of magnitude where the real
game reads the analog value.

**Known limits.** No online rematch: after a match both players go back through the lobby.
Online KO/fall/SD credit is counted from each frame's events as first shown, so a rollback that
changes a hit after it was drawn can misattribute one; the placings come from the confirmed final
state and are always right. Without a TURN key the Worker serves STUN only, which is the interim
state if creating the key turns out to need a card.
```

Replicates root `README.md` — replace the heading `## [super-smash](super-smash) — Super Smash Bros. Ultimate, on a laptop keyboard` with `## [super-smash](super-smash) — David-Smash: Super Smash Bros. Ultimate, in the browser, online`, insert directly under the `> **eight fighters, one keyboard, sixty frames a second**` line a blank line and `**Live: [david-smash.leaders-game.workers.dev](https://david-smash.leaders-game.workers.dev)** · two players online by room code, keyboard or gamepad.`, and replace the paragraph starting "It also does one thing the original does not" with:

```markdown
It also does one thing the original does not: **rollback netcode**, online. Ultimate is
delay-based. Two browsers meet through a room code in a Cloudflare Durable Object, then play peer
to peer over WebRTC, with Cloudflare TURN when no direct path exists — and on shared WiFi, ICE
prefers the LAN route on its own, so two laptops in one room get a sub-10ms path for free.
```

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run src/lib/envExample.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/lib/envExample.test.ts super-smash/.env.example super-smash/README.md super-smash/DECISIONS.md README.md super-smash/docs/superpowers super-smash/research/rebuild-2026-10
git commit -m "super-smash: document David-Smash on Cloudflare, online play and gamepads (D54)" -m ".env.example now names only the two Worker TURN secrets; the three NEXT_PUBLIC_ variables it listed were never read. README covers pnpm preview, the room flow, the Worker and deploys; the Replicates index links the live URL." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Deploy the Worker, add TURN, and verify the public site (outward — gated)

**Files:** none changed (verification and deployment only).

**Interfaces:**
- Consumes: `pnpm run deploy` (Task 7), `src/net/roomWorker.integration.test.ts` (Task 7), `SMASH_URL` suites (Task 22).
- Produces: `https://david-smash.leaders-game.workers.dev` live; secrets `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` set on Worker `david-smash`; `main` pushed.

- [ ] **Step 1: Read-only preflight**

Run: `git -C "/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates" status --short super-smash && pnpm exec wrangler whoami`
Expected: no uncommitted files under `super-smash/` (the spec, plans and `research/rebuild-2026-10/` were committed in Task 23); `wrangler whoami` shows the account for `Davidb.sites@gmail.com`. If it says "not authenticated": **STOP: ask David** to run `! cd "/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/super-smash" && pnpm exec wrangler login` (spec §3.1: David runs it), then rerun this step.

- [ ] **Step 2: STOP: ask David for go to deploy.** Say: "Deploying Worker `david-smash` (static assets from `out/`, `RoomDO` SQLite migration v1) to your free Cloudflare account at https://david-smash.leaders-game.workers.dev. No paid feature is used. Go?" On go:

Run: `pnpm run deploy`
Expected: `next build` succeeds; wrangler uploads the assets, applies migration `v1`, and prints `https://david-smash.leaders-game.workers.dev`. If wrangler asks for a workers.dev subdomain, a paid plan or a card — **STOP** and ask David (spec §3.1); do not accept.

- [ ] **Step 3: Verify the public site (STUN-only for now)**

```bash
SMASH=https://david-smash.leaders-game.workers.dev
curl -s $SMASH/ | grep -o "<title>[^<]*</title>"
for p in /menu /online /fighters /play /results; do curl -s -o /dev/null -w "$p %{http_code}\n" $SMASH$p; done
curl -s -o /dev/null -w "%{http_code}\n" $SMASH/no-such-page
curl -s $SMASH/api/ice
WORKER_URL=$SMASH pnpm vitest run src/net/roomWorker.integration.test.ts
```
Expected: `<title>David-Smash</title>`; every route `200`; `404`; `{"iceServers":[{"urls":["stun:stun.cloudflare.com:3478"]}],"turn":false}`; 3 passed.

- [ ] **Step 4: STOP: ask David to create the TURN key and set the secrets.** Ask him to open the Cloudflare dashboard → Realtime → TURN Server → Create TURN key (docs: https://developers.cloudflare.com/realtime/turn/). If it asks for a card or a paid plan, **STOP and ask David** whether to add one — do not add it yourself (spec §3.1). STUN-only is the planned interim state (planner's default; David can overrule at plan review): skip the rest of this step and Step 5's relay run, and report TURN as pending. Otherwise David runs, from `super-smash/`:

```
! pnpm exec wrangler secret put TURN_KEY_ID
! pnpm exec wrangler secret put TURN_KEY_API_TOKEN
```

Then run: `curl -s https://david-smash.leaders-game.workers.dev/api/ice | grep -o '"turn":true'`
Expected: `"turn":true` (secrets apply without a redeploy).

- [ ] **Step 5: Run every e2e against the public site, including a match forced through TURN**

```bash
SMASH_URL=https://david-smash.leaders-game.workers.dev pnpm test:e2e
SMASH_URL=https://david-smash.leaders-game.workers.dev pnpm test:e2e:online
SMASH_URL=https://david-smash.leaders-game.workers.dev SMASH_FORCE_RELAY=1 pnpm test:e2e:online
```
Expected: all pass. The third run uses `iceTransportPolicy: "relay"`, so it can only connect through Cloudflare TURN. If only the third fails, TURN is not usable: check Step 4's secrets and `/api/ice` before anything else.

- [ ] **Step 6: STOP: ask David for go to push `main`.** Say: "Pushing Replicates `main` (Tasks 1–23). Note: the Vercel project `smash-david` (Root Directory `super-smash`) appears to be Git-connected — every Replicates project redeployed on the last push — so it will build once more from this commit; harmless, it is removed in Task 27." On go:

Run: `git -C "/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates" push origin main`
Expected: push succeeds (never force).

---

### Task 25: Point David-Internet at David-Smash (outward deploy gated)

Git and pnpm in this task run in `/Users/fobrizzlemynizzle/Documents/Personal Projects/David-Internet` (its own repo; commits go to its `main`).

**Files:**
- Create: `David-Internet/tests/david-smash.test.ts`
- Modify: `David-Internet/src/lib/wiki.ts:59-63` (`wikiTitleFor` — it derives "Super Smash (replica)" from the kept slug, and that string is the docs search result's title (`src/lib/content.server.ts:141`) and the forwarding page's title (`src/app/sites/[project]/docs/page.tsx:49`)), `David-Internet/content/super-smash/site.ts` (:5,:7,:11,:19,:30,:37,:44,:51,:58,:65,:72,:79 + new deep link, keywords, knowledge panel), `David-Internet/README.md:25,:53`, `David-Internet/e2e/images.spec.ts:3,:22`, `David-Internet/e2e/feeling-lucky.spec.ts:19,:43`, `David-Internet/content/path/journey.ts:289`, vendored `David-Internet/content/super-smash/{README,SPEC,DECISIONS}.md` (via `pnpm sync-content`)
- Not touched: `vercel.json` (the `/sites/super-smash/docs` → `Super_Smash_%28replica%29` redirect is correct because the wiki slug stays).
- Dirty before this task, from another session: `package.json`, `pnpm-lock.yaml`, `vercel.json`. Leave all three unstaged and unedited.

**Interfaces:** consumes the live URL from Task 24.

- [ ] **Step 1: Write the failing tests** — `tests/david-smash.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAllSearchDocs } from "@/lib/content.server";
import { getManifest } from "@/lib/manifests";
import { createEngine } from "@/lib/search";
import { WIKI_SLUGS, wikiTitleFor } from "@/lib/wiki";

const LIVE = "https://david-smash.leaders-game.workers.dev";

describe("David-Smash (the super-smash replica)", () => {
  it("is called David-Smash and links to its Cloudflare deployment", () => {
    const manifest = getManifest("super-smash");
    expect(manifest?.displayName).toBe("David-Smash");
    expect(manifest?.liveUrl).toBe(LIVE);
  });

  it("is still found by its old name", () => {
    const hits = createEngine(loadAllSearchDocs()).search("super smash");
    expect(hits.some((h) => h.doc.project === "super-smash")).toBe(true);
  });

  it("indexes the online lobby", () => {
    expect(getManifest("super-smash")?.deepLinks.some((l) => l.path === "/online")).toBe(true);
  });

  it("titles its wiki article David-Smash while keeping the old slug", () => {
    expect(WIKI_SLUGS["super-smash"]).toBe("Super_Smash_(replica)");
    expect(wikiTitleFor("super-smash")).toBe("David-Smash (replica)");
    expect(wikiTitleFor("linear")).toBe("Linear (replica)");
    const docs = loadAllSearchDocs().find((d) => d.id === "super-smash:docs");
    expect(docs?.title).toContain("David-Smash (replica)");
  });

  it("is labelled David-Smash on the journey", () => {
    const journey = fs.readFileSync(path.join(process.cwd(), "content", "path", "journey.ts"), "utf8");
    expect(journey).toContain('{ slug: "super-smash", label: "David-Smash", status: "docs" }');
  });
});
```

In `e2e/images.spec.ts` replace `const SMASH_LIVE_URL = "https://smash-david.vercel.app";` with `const SMASH_LIVE_URL = "https://david-smash.leaders-game.workers.dev";` and `page.context().route("https://smash-david.vercel.app/**", …` with `page.context().route("https://david-smash.leaders-game.workers.dev/**", …`.

In `e2e/feeling-lucky.spec.ts` replace the `"smash-david.vercel.app",` entry of `LIVE_REPLICA_HOSTS` with `"david-smash.leaders-game.workers.dev",`, and in the `waitForURL` regex replace `smash-david\.vercel\.app` with `david-smash\.leaders-game\.workers\.dev`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run tests/david-smash.test.ts && pnpm e2e e2e/images.spec.ts`
Expected: FAIL — `expected 'Super Smash' to be 'David-Smash'`; the image tile's `href` is still `https://smash-david.vercel.app`.

- [ ] **Step 3: Implement** — `src/lib/wiki.ts`: replace the `wikiTitleFor` doc comment and function with

```ts
/**
 * Articles whose title no longer follows from their slug. The slug stays so
 * every inbound link keeps working; the title follows the product's name.
 */
const WIKI_TITLE_OVERRIDES: Record<string, string> = {
  "super-smash": "David-Smash (replica)",
};

/** The article's display title, derived from its slug ("Linear_(replica)" → "Linear (replica)") unless overridden. */
export function wikiTitleFor(project: string): string | null {
  const override = WIKI_TITLE_OVERRIDES[project];
  if (override) return override;
  const slug = WIKI_SLUGS[project];
  return slug ? slug.replace(/_/g, " ") : null;
}
```

`content/super-smash/site.ts`:
- `displayName: "Super Smash",` → `displayName: "David-Smash",`
- `liveUrl: "https://smash-david.vercel.app",` → `liveUrl: "https://david-smash.leaders-game.workers.dev",`
- in `description`, replace `It adds rollback netcode over WebRTC, something the original (delay-based) doesn't have.` with `It adds online play with rollback netcode over WebRTC — two browsers meet through a room code on a Cloudflare Durable Object, with Cloudflare TURN behind it — something the original (delay-based) doesn't have.`
- in `techStack`, replace `"Trystero (WebRTC)",` with `"WebRTC (Durable Object signalling)",` and add `"Cloudflare Workers + Durable Objects",` after it
- deep-link titles: `"Super Smash: Title"` → `"David-Smash: Title"`, and `"Main Menu: Super Smash"`, `"Character Select: Super Smash"`, `"Stage Select: Super Smash"`, `"Rules: Super Smash"`, `"Match: Super Smash"`, `"Controls: Super Smash"`, `"Results: Super Smash"` → the same with `David-Smash`
- after the `/play` deep link, add:

```ts
    {
      path: "/online",
      title: "Online: David-Smash",
      snippet:
        "Create a room and read out its four-letter code, or type one in: two browsers, rollback netcode, Cloudflare TURN when no direct path exists.",
      keywords: ["smash online", "room code", "play smash online"],
    },
```
- in the top-level `keywords`, replace `"trystero webrtc game",` with `"cloudflare durable objects game",` and add `"david-smash",` (keep `"super smash bros"`)
- `knowledgePanel.facts.Netcode` → `"Rollback over WebRTC (Durable Object signalling, Cloudflare TURN), 2 frames of input delay, 8-frame prediction cap"`

`README.md:25` — in "(Linear, Notion, Super Smash, fake-phone, Bet, FL Studio, Dollar Pixels)" replace `Super Smash` with `David-Smash`; `README.md:53` — replace the row with ``| David-Smash | smash.davids.net | no | [david-smash.leaders-game.workers.dev](https://david-smash.leaders-game.workers.dev) |``.

`content/path/journey.ts:289` — `{ slug: "super-smash", label: "Super Smash", status: "docs" },` → `{ slug: "super-smash", label: "David-Smash", status: "docs" },`

Re-vendor the docs (Task 23 changed them): `pnpm sync-content`, then keep only the super-smash part: `git status --short content public/content` and stage only `content/super-smash/` and `public/content/super-smash/`.

- [ ] **Step 4: Run the tests again**

Run: `pnpm test && pnpm e2e e2e/images.spec.ts e2e/feeling-lucky.spec.ts && pnpm build && ! grep -rl "smash-david.vercel.app" out`
Expected: all green (including `tests/wiki-redirects.test.ts` "finds every project when searching its display name" for "David-Smash"); the final grep finds nothing.

- [ ] **Step 5: Commit** (from the David-Internet root)

```bash
git add tests/david-smash.test.ts src/lib/wiki.ts content/super-smash/site.ts README.md e2e/images.spec.ts e2e/feeling-lucky.spec.ts content/path/journey.ts content/super-smash public/content/super-smash
git commit -m "Point the super-smash entry at David-Smash on Cloudflare" -m "Display name David-Smash, live URL https://david-smash.leaders-game.workers.dev, an /online deep link, and the e2e hosts updated. The super-smash slug and its wiki redirect stay." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: STOP: ask David before pushing or deploying David-Internet.** Tell him: "`package.json`, `pnpm-lock.yaml` and `vercel.json` carry uncommitted edits from another session, and `pnpm deploy-private` builds the working tree, so they would ship too. Deploy with them, or wait?" Do not run `deploy-private` until he answers, and never ship those edits silently. If he says wait, stop here and report Task 25 as committed but not deployed (Task 27 then waits too). On an explicit go:

```bash
git status --short
git fetch origin && git status -sb | head -1
git push origin main
pnpm deploy-private
```
Expected: `git status --short` shows only the three files David has just decided about; the branch is not behind `origin/main` before pushing; `deploy-private` (sync-private, tests, `vercel build --prod`, scrub, `vercel deploy --prebuilt --prod`) ends with the production URL aliased to `https://david-internet.vercel.app`. A first-call `Not authorized` is transient: run `npx vercel whoami` and retry. Use `pnpm deploy-private`, never a bare `vercel deploy`, or the unlisted section is wiped.

- [ ] **Step 7: Verify live**

Run: `cd "/Users/fobrizzlemynizzle/Documents/Personal Projects/David-Internet" && BASE_URL=https://david-internet.vercel.app npx playwright test e2e/images.spec.ts` if the DI Playwright config honours `BASE_URL`; otherwise open `https://david-internet.vercel.app/search?q=smash&tab=images` and confirm the first tile links to `https://david-smash.leaders-game.workers.dev`.
Expected: the tile's `href` is the Cloudflare URL.

---

### Task 26: Rename and relink the Wikipedia article (outward deploy gated)

Git runs from the Replicates root; pnpm runs in `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/Wikipedia`.

**Files:**
- Modify: `Wikipedia/src/content/projects.ts:80-93`, `Wikipedia/src/content/articles/meta.ts:54-60`, `Wikipedia/src/content/articles/super-smash.tsx:39,43,68,93-99`, `Wikipedia/src/content/articles/{dollar-pixels.tsx:127,fl-studio.tsx:111,island-empire.tsx:133,fake-phone.tsx:113,leaders.tsx:214}` (See-also link text), `Wikipedia/src/content/articles/davids-internet.tsx:91`, `Wikipedia/src/content/__tests__/sections.test.tsx:46`, `Wikipedia/src/content/__tests__/projects.test.ts` (append), `Wikipedia/e2e/support.ts:13,40`, `Wikipedia/README.md:10`
- Unchanged on purpose: the slug `Super_Smash_(replica)` everywhere (David-Internet's redirect and `EXPECTED_LIVE` depend on it).

- [ ] **Step 1: Write the failing test** — append inside the top-level `describe` of `src/content/__tests__/projects.test.ts`:

```ts
  it("calls the smash replica David-Smash and links its Cloudflare deployment, under the old slug", () => {
    const smash = projects.find((p) => p.slug === "Super_Smash_(replica)");
    expect(smash?.name).toBe("David-Smash");
    expect(smash?.liveUrl).toBe("https://david-smash.leaders-game.workers.dev");
    expect(articles["Super_Smash_(replica)"]?.meta.title).toBe("David-Smash (replica)");
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/content/__tests__/projects.test.ts`
Expected: FAIL — `expected 'Super Smash' to be 'David-Smash'`.

- [ ] **Step 3: Implement**
- `projects.ts`: `name: "Super Smash",` → `name: "David-Smash",`; `liveUrl: "https://smash-david.vercel.app",` → `liveUrl: "https://david-smash.leaders-game.workers.dev",`; in `stack`, after `"WebRTC rollback netcode",` add `"Cloudflare Workers + Durable Objects",`.
- `articles/meta.ts` (`superSmashMeta`): `slug: projectSlug("Super Smash"),` → `slug: projectSlug("David-Smash"),`; `title: "Super Smash (replica)",` → `title: "David-Smash (replica)",`; `lastEdited: "18 August 2026",` → `lastEdited: "24 October 2026",`.
- `articles/super-smash.tsx`: `title="Super Smash (replica)"` → `title="David-Smash (replica)"`; `alt="Screenshot of the Super Smash replica's main menu"` → `alt="Screenshot of the David-Smash replica's main menu"`; `<B>Super Smash (replica)</B>` → `<B>David-Smash (replica)</B>`; replace `          relying on ICE host candidates.` with

```tsx
          relying on ICE host candidates. Since October 2026 the two browsers
          find each other through a room code held by a Durable Object on a
          Cloudflare Worker, which also serves the game and mints Cloudflare
          TURN credentials for networks a direct connection cannot cross.
```
- In `dollar-pixels.tsx`, `fl-studio.tsx`, `island-empire.tsx`, `fake-phone.tsx`, `leaders.tsx`: `<WikiLink to="Super_Smash_(replica)">Super Smash (replica)</WikiLink>` → `<WikiLink to="Super_Smash_(replica)">David-Smash (replica)</WikiLink>`.
- `davids-internet.tsx:91`: `(Linear, Notion, Super Smash, Fake Phone, Bet, FL Studio, and Dollar` → `(Linear, Notion, David-Smash, Fake Phone, Bet, FL Studio, and Dollar`.
- `__tests__/sections.test.tsx:46`: `name: "Super Smash (replica)"` → `name: "David-Smash (replica)"`.
- `e2e/support.ts`: `"Super Smash (replica)",` (KNOWN_TITLES) → `"David-Smash (replica)",`; `{ linkText: "Super Smash", title: "Super Smash (replica)" },` → `{ linkText: "David-Smash", title: "David-Smash (replica)" },`.
- `Wikipedia/README.md:10`: `Super Smash` → `David-Smash` in the replica list.

- [ ] **Step 4: Run the wiki's full verification and its e2e**

Run: `pnpm run verify && pnpm test:e2e && ! grep -rn "smash-david" src`
Expected: typecheck, lint, unit tests and the bundle test pass; e2e passes with the renamed link text; no `smash-david` left in `src`.

- [ ] **Step 5: Commit** (from the Replicates root)

```bash
git add Wikipedia/src/content/projects.ts Wikipedia/src/content/articles/meta.ts Wikipedia/src/content/articles/super-smash.tsx Wikipedia/src/content/articles/dollar-pixels.tsx Wikipedia/src/content/articles/fl-studio.tsx Wikipedia/src/content/articles/island-empire.tsx Wikipedia/src/content/articles/fake-phone.tsx Wikipedia/src/content/articles/leaders.tsx Wikipedia/src/content/articles/davids-internet.tsx Wikipedia/src/content/__tests__/sections.test.tsx Wikipedia/src/content/__tests__/projects.test.ts Wikipedia/e2e/support.ts Wikipedia/README.md
git commit -m "wikipedia: the smash replica is David-Smash, live on Cloudflare" -m "Name, title and link text change; the Super_Smash_(replica) slug stays so David-Internet's redirect and every inbound link keep working." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Read-only — find out how the wiki deploys.** The wiki README describes a Git import with Root Directory `Wikipedia/`; this machine's notes say it is deployed by hand with the CLI. Check before choosing:

```bash
npx vercel project inspect davids-wikipedia
npx vercel ls davids-wikipedia | head -8
```
Expected: the Root Directory is `Wikipedia`. Note whether recent Production deployments came from Git pushes (a deployment appearing minutes after each Replicates push, with a commit message) or from CLI deploys.

- [ ] **Step 7: STOP: ask David for go to push and deploy the wiki.** On go, from the Replicates root:

```bash
cd "/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates"
git push origin main
```

Then branch on Step 6:
- **Git-connected:** the push deploys it. Wait for it with `npx vercel ls davids-wikipedia | head -4` until a Production deployment newer than the push shows `Ready`. Do not also run a CLI deploy.
- **Not Git-connected (manual CLI, as this machine's notes say):** deploy from the Replicates root with the wiki's own ids. The root `.vercel/project.json` belongs to dollar-pixels-david, so never deploy with that link, and running inside `Wikipedia/` fails because the project's Root Directory is `Wikipedia`:

```bash
VERCEL_ORG_ID=$(node -p "require('./Wikipedia/.vercel/project.json').orgId") \
VERCEL_PROJECT_ID=$(node -p "require('./Wikipedia/.vercel/project.json').projectId") \
npx vercel deploy --prod --yes
```
Expected: a production deployment aliased to `https://davids-wikipedia.vercel.app`. A first-call `Not authorized` is transient (`npx vercel whoami`, retry).

- [ ] **Step 8: Verify live**

Run: `curl -s "https://davids-wikipedia.vercel.app/wiki/Super_Smash_%28replica%29" | grep -o "David-Smash (replica)\|david-smash.leaders-game.workers.dev\|smash-david" | sort | uniq -c`
Expected: counts for `David-Smash (replica)` and `david-smash.leaders-game.workers.dev`; none for `smash-david`.

---

### Task 27: Remove the Vercel project behind `smash-david.vercel.app` (outward — gated)

**Files:** none.

Facts gathered read-only on 2026-10-24 (`npx vercel project ls`, `npx vercel project inspect smash-david`, CLI 65.2.0): project **`smash-david`**, id `prj_6JeSmvPLe2VSmpFBABQpkWa9ESSK`, scope `dabrin-1378s-projects`, Root Directory `super-smash`, created 2026-09-01; `vercel project rm` is the `project delete` command and takes `--yes`.

- [ ] **Step 1: Read-only preconditions — nothing live still points at the old URL**

```bash
npx vercel project inspect smash-david | head -12
npx vercel alias ls | grep -i smash
curl -s "https://davids-wikipedia.vercel.app/wiki/Super_Smash_%28replica%29" | grep -c smash-david
grep -rl "smash-david.vercel.app" "/Users/fobrizzlemynizzle/Documents/Personal Projects/David-Internet/out" | wc -l
```
Expected: the project details above; only `smash-david.vercel.app` (and Vercel's per-deployment aliases) listed; `0`; `0`. Tasks 24–26 must be live first — if any count is non-zero, stop and finish those.

- [ ] **Step 2: STOP: ask David for go.** Say: "Deleting Vercel project `smash-david` (prj_6JeSmvPLe2VSmpFBABQpkWa9ESSK, Root Directory super-smash). This permanently removes https://smash-david.vercel.app and all its deployments; old links will 404. David-Smash now lives at https://david-smash.leaders-game.workers.dev. Go?" On go:

Run: `npx vercel project rm smash-david --yes --scope dabrin-1378s-projects`
Expected: the project is deleted. If the command is refused as a destructive action in this session, ask David to run exactly that line with `!`.

- [ ] **Step 3: Verify**

```bash
npx vercel project ls | grep -c smash-david
curl -s -o /dev/null -w "%{http_code}\n" https://smash-david.vercel.app
grep -rnI "smash-david" "/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates" "/Users/fobrizzlemynizzle/Documents/Personal Projects/David-Internet" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out --exclude-dir=.vercel -l
```
Expected: `0`; `404` (DEPLOYMENT_NOT_FOUND); the only files left mentioning it are history — `super-smash/docs/superpowers/**`, `super-smash/research/**` and `island-empire/research/00-repo-conventions.md`.

---

## Self-review

- **Spec §3.3 coverage:** Name (title, menus, README, package name, Worker name, Trystero/rooms appId, /fighters and results titles, DI and wiki display names; slugs kept) → Tasks 1, 7, 23, 25, 26. Build (`output: "export"` into `out/`; Worker `david-smash`, `assets.directory = "./out"`, `run_worker_first` for `/api/*` and `/ws/*`) → Tasks 2, 7. Signalling (SQLite `RoomDO`, hibernation, `idFromName` by 4-letter code, max 2 peers, relays SDP/ICE, alphabet unchanged) → Tasks 3, 4, 5, 7. TURN (`GET /api/ice`, TTL 4 h, two secrets via `wrangler secret put` by David, STUN fallback `stun.cloudflare.com:3478`) → Tasks 6, 8, 24. Transport (new adapter on the existing `Transport` port, `ordered:false, maxRetransmits:0`, negotiated id 42; Trystero kept) → Tasks 3, 9, 10, 13. Online UI (live tile, create/join, existing select screens with host-picked stage, `matchRunner` + `RollbackSession`, ping/delay/rollbacks, "Connection lost") → Tasks 12, 14, 17, 18, 19, 20, 21. Gamepad (local and online; walk, tilt, partial DI; keyboard stays) → Tasks 15, 16, 17, 21. Remediation 1 (deploy + public e2e + two-browser match through TURN) → Tasks 22, 24; Remediation 2 (DI `site.ts`, README, `images.spec`, `feeling-lucky.spec`; wiki `projects.ts` + display name; manual Vercel CLI redeploys) → Tasks 25, 26; Remediation 3 (remove the Vercel project, gated) → Task 27. README/.env.example (stale variables removed) → Task 23.
- **Placeholders:** none — every step carries its code, command and expected output.
- **Type consistency:** `OnlineSessionLike` (Task 13) is what Tasks 14, 18, 19, 20, 21 consume; `DoSignalTransport.role/status` (Task 10) feed `OnlineSession.role` and the `link` event; `LobbyMessage`/`OnlineMatchConfig` (Task 12) flow through `sendLobby` (Task 14) and `buildStartConfig` (Task 12) into `runnerSlotsFor` (Task 21); `NetplayOptions` (Task 17) is built in Task 21; `MatchResult.kind`/`online` (Task 14) are rendered in Task 18 and produced in Task 21; `LinkHealth` (Task 11) is consumed by Tasks 21's `linkMonitor` and `NetHud`.
- **Review Focus tests placed:** full room → Tasks 5, 7, 19, 22; typed code → Tasks 3, 19, 22; backgrounded tab → Tasks 11, 21; TURN missing/failing → Tasks 6, 8; deploy restarts the DO → Tasks 10, 13.
