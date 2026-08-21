# Stack & deployment fit — Lane 7

Research lane 7 for the FL Studio clone. Verifies (does not re-derive) that this
repo's standard stack — see
[`Wikipedia/research/01-repo-conventions.md`](../../Wikipedia/research/01-repo-conventions.md),
re-confirmed here against the newest sibling, `youtube/` — has no real-time-audio
blocker. Short by design, per the brief.

Confidence: **HIGH** (primary source, quoted), **MED** (secondary source,
consistent across several), **LOW** (inference, flagged unverified).

---

## 0. Pinned versions to reuse (confirmed against `youtube/package.json`, 2026-08-20)

`next` 16.3.0, `react`/`react-dom` 19.2.8, `typescript` ^5, `tailwindcss` ^4 +
`@tailwindcss/postcss` ^4, `vitest` ^4.1.10 + `@vitest/coverage-v8`,
`@playwright/test` ^1.62.1, `eslint` ^9 + `eslint-config-next` 16.3.0,
`@testing-library/jest-dom` ^7, `@testing-library/react` ^16.3.2,
`@testing-library/user-event` ^14.6.3, `jsdom` ^30.0.1, `@vitejs/plugin-react`
^6.0.5, `vite` ^8.2.1, `vite-tsconfig-paths` ^6.1.1, `clsx` ^2.1.1, `@types/node`
^20, `zustand` ^5.0.15 (if client state needs a store beyond React state — the
audio clone has no server/DB, so `nanoid`/`zod`/`jose`/Neon/S3 deps are
`youtube`-specific and don't carry over). pnpm via `pnpm-workspace.yaml`, no
`packageManager` field. **HIGH** — read directly off
`/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/youtube/package.json`.

No audio-specific reason to deviate from any of these pins. **HIGH**

---

## 1. Next.js App Router + AudioContext (SSR boundary)

**No special-case handling beyond what the repo already does for `window`.**
Next's App Router renders Server Components on the server by default, where
`window`/`AudioContext` don't exist; the fix is the same one already used
anywhere in these sibling repos for browser-only globals: keep audio-engine
code inside a `"use client"` component and only touch `AudioContext` inside an
effect or an event handler, never at module top level or render time.

```tsx
"use client";
import { useEffect, useRef } from "react";

export function useAudioEngine() {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    // Constructed lazily, and only client-side; effects never run during SSR.
  }, []);
}
```

`dynamic(() => import(...), { ssr: false })` is only needed for a component
that would otherwise *evaluate* `new AudioContext()` during the render pass
itself (e.g. as a `useState` initializer or top-level singleton import) — normal
`"use client"` + `useEffect`/click-handler initialization does not need it,
because Next never executes effects server-side. **MED** — this is the
consistent, unanimous guidance across React/Next community sources (GeeksforGeeks,
Sentry, FlowQL, Medium — 2026 vintage) rather than one authoritative doc page;
the pattern itself is standard React SSR behavior, not Next-specific.

Second, real constraint that's actually FL-Studio-specific and worth flagging
for lane 3/spec: Chrome (and Safari) require a **user gesture** before
`AudioContext` will run — a freshly constructed context starts `"suspended"`
and must be `.resume()`d from inside a click/keydown handler, not from an
effect that fires on mount. This is an interaction-design constraint (the
clone needs an explicit "start" affordance, e.g. clicking the transport play
button, matching how FL Studio and every other browser DAW handles it), not an
SSR problem — flagging it here because lane 3 should account for it in the
scheduler design. **HIGH** — confirmed independently via the Chromium autoplay
policy pages and the Playwright issue below (both describe the same
`suspended`-until-gesture behavior as of Chrome M70+, still current).

No Next.js config change is needed for any of this — `next.config.ts` stays as
minimal as `youtube`'s (see §0/repo-conventions); no `serverExternalPackages`
entry is needed because nothing audio-related runs server-side.

---

## 2. Testing Web Audio: jsdom has none, Playwright can use real audio

**jsdom does not implement the Web Audio API at all** — no `AudioContext`,
`AudioBuffer`, `AudioNode`, etc. Any component/domain-logic test that touches
these under Vitest's `jsdom` environment (per `youtube/vitest.config.mts`:
`environment: "jsdom"`) needs a mock.

**Recommended: `standardized-audio-context-mock`** (npm, by chrisguttandin,
who also maintains the widely-used `standardized-audio-context` polyfill
library). Its own README states its purpose directly: *"This library is meant
to test code which is using standardized-audio-context without actually
rendering any audio."* It exports mock `AudioContext`, `AudioBuffer`, and a
`registrar` utility for inspecting nodes created during a test (e.g.
`registrar.getAudioNodes(audioContextMock, 'AudioBufferSourceNode')`), and it's
mocking-library-agnostic via `setMockingImplementation()` — the README
documents a Vitest wiring directly:
`setMockingImplementation((defaultImplementation) => vi.fn().mockImplementation(defaultImplementation))`.
**HIGH** — quoted from <https://github.com/chrisguttandin/standardized-audio-context-mock>
(fetched 2026-08-20) and <https://www.npmjs.com/package/standardized-audio-context-mock>.

Two caveats for the spec-writer:
- This mock pairs naturally with also depending on `standardized-audio-context`
  (a cross-browser-consistent Web Audio polyfill/wrapper) at runtime, since the
  mock's API surface matches that library, not the raw browser API 1:1. If the
  clone codes directly against the browser's native `AudioContext` types
  instead, a **hand-rolled stub** (a plain object satisfying the subset of the
  `AudioContext`/`AudioNode` interface the domain logic actually calls —
  `createGain`, `createOscillator`, `currentTime`, `destination`, etc.) is the
  lower-dependency alternative and is likely sufficient given this project's
  narrow audio-engine surface (lane 3's scope: gain nodes, oscillators, buffer
  sources, a master bus). Decide based on how much of `AudioContext`'s surface
  lane 3's scheduler actually touches — recommend the hand-rolled stub unless
  the domain layer ends up calling into more than ~5-6 node types, at which
  point the maintained mock earns its keep. **MED** (reasoned recommendation,
  not read off a source).
- Vitest's `alias` mechanism (already used in `youtube/vitest.config.mts` to
  stub `server-only`) is the right place to wire either approach — e.g. alias a
  thin `src/test-support/audio-context-stub.ts` the same way, rather than
  mocking per-test.

**Playwright CAN exercise real audio in Chromium**, and the sibling `youtube`
project already does exactly this for its own audio/video autoplay assertions.
Its `playwright.config.ts` passes:
```
launchOptions: {
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
},
```
with the comment "the autoplay override lets the player's autoplay assertions
run without a user gesture, which no headless run has." **HIGH** — read
directly from
`/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/youtube/playwright.config.ts`.
This flag is exactly what an FL Studio e2e suite needs to click "play" and
assert on scheduling/playback behavior without fighting the gesture
requirement in headless CI.

One nuance for lane 3/e2e design: Playwright's *default* Chromium (without the
flag) actually already gives `AudioContext` a `"running"` initial state rather
than the real browser's `"suspended"` — the opposite problem, confirmed by an
open Playwright feature request
(<https://github.com/microsoft/playwright/issues/33590>, MED — a GitHub issue,
not a resolved doc, but internally consistent with Chromium's own autoplay
docs): *"When creating a new AudioContext, its initial state is 'running' …
does not reflect the initial state encountered by users."* So Playwright is
actually **permissive by default** for audio testing (no gesture-gating
hassle), and `--autoplay-policy=no-user-gesture-required` used by `youtube`
is belt-and-suspenders for the `<video>`/`<audio>` element autoplay case
specifically — not required to make `AudioContext.resume()` succeed in
Playwright's Chromium, but worth keeping for consistency with the sibling
config and because it doesn't hurt. **MED**

---

## 3. Static audio assets (wav/mp3) in `public/`

No special handling required — Next.js serves anything under `public/` verbatim
at the matching URL path, same as `youtube`'s `public/` usage. **HIGH** —
per Next's own docs (<https://nextjs.org/docs/app/api-reference/file-conventions/public-folder>,
fetched 2026-08-20, doc version 16.3.1): *"Next.js can serve static files… under
a folder called `public`… Files inside `public` can then be referenced by your
code starting from the base URL (`/`)."*

One real gotcha worth carrying into the spec: Next's default caching header for
`public/` assets is `Cache-Control: public, max-age=0` (quoted from the same
page) — i.e. **no long-lived caching by default**. For a handful of small
synth-adjacent samples this is a non-issue; if lane 4 recommends a larger
sample-backed kit (multiple velocity layers × multiple drum voices), consider
adding an explicit `headers()` rule in `next.config.ts` for a `/samples/:path*`
prefix setting `Cache-Control: public, max-age=31536000, immutable` — `youtube`'s
`next.config.ts` already has precedent for scoped `headers()` rules (its
COOP/COEP headers on `/studio/:path*`), so this is a one-line addition, not a
new pattern. **MED** (reasoned recommendation).

No content-type/MIME issues expected — Next serves `public/` files with
standard static-file MIME detection; `.wav`/`.mp3`/`.ogg` are unremarkable.

---

## 4. Bundle size if Tone.js is adopted (lane 3 decision)

Tone.js is commonly cited at **~20 KB gzipped** for the full library (per a
2026 Tone.js vs. Howler.js comparison found via search — **MED**, a secondary
source, not Tone.js's own published number, and tree-shaking behavior with
Tone's ESM build was not independently verified in this pass). For context,
this is small relative to the sibling stack's own bundle (React 19 + Next 16
runtime is already the dominant payload for a client component); a 20 KB
addition is not a deployment blocker on Vercel's static/edge CDN either way.
If lane 3 wants a harder number, re-check `bundlejs.com` or
`npmjs.com/package/tone` → "Unpacked Size"/"exports" at implementation time
rather than trusting this figure at spec-write time — flagged **LOW** for the
exact number, **MED** for "small enough not to matter for this project's
deployment target."

This is Tone.js's bundle-size cost only — lane 3 owns whether Tone.js vs. raw
Web Audio API is the right call architecturally; this lane only confirms the
size isn't a stack/deployment blocker either way.

---

## 5. Vercel deployment

Confirmed rather than assumed, per the brief: **a purely client-side Web Audio
app has zero deployment-relevant surface for Vercel beyond what any static
Next.js App Router site already gets.** There is no database, no API route, no
server action needed for the core sequencing loop (playback is 100% in-browser
Web Audio; the "project" — patterns, channels, notes — needs no server
persistence per lane 2's scope, unless lane 2 decides otherwise). This matches
`Wikipedia/research/01-repo-conventions.md`'s existing note: *"Zero config:
import the repo, point the project root at the project folder… a static
project deploys with no env vars at all."* **HIGH** — consistent with that
prior lane's finding and with Vercel's own Next.js docs describing zero-config
Git-connected deploys (<https://vercel.com/docs/frameworks/full-stack/nextjs>,
**MED** — general framework doc, not audio-specific, because there's nothing
audio-specific to check).

**The `"FL Studio"` folder name contains a space** — the one real repo-specific
risk this lane needs to flag. Two things were checked:

- **Vercel's root-directory setting**: Vercel's project settings store the root
  directory as a path string and pass it through to its build container's `cd`
  equivalent; a space in a path is a standard shell/config value, not a URL, so
  it does not need percent-encoding the way a URL does. No sibling project in
  this repo has hit a Vercel-side issue from the parent `Replicates` folder
  already containing no spaces itself — note `FL Studio` would be the *project*
  folder, analogous to `Wikipedia`, `youtube`, `Linear`, none of which have
  spaces, so this is genuinely the first sibling to test this. Not independently
  verified against a live Vercel deploy in this pass — recommend confirming at
  actual deploy time, not spec time. **LOW** (inference; flag for the spec/impl
  agent to verify empirically before treating as settled).
- **Next.js/Turbopack and the space**: the repo already has one proven, sharp
  gotcha from a space in a path — not in the project folder name itself, but in
  the *parent* directory (`Personal Projects/Replicates` has no space, but this
  whole repo lives under `/Users/.../Documents/Personal Projects/Replicates/`,
  which does). `youtube/vitest.config.mts` documents this exactly: *"this
  repository lives under a directory with a space in its name, and
  `.pathname` hands back a percent-encoded path that resolves to nothing... use
  `fileURLToPath`, not `URL.pathname`"* — already fixed once in `next.config.ts`'s
  `turbopack.root` pin (`fileURLToPath(new URL(".", import.meta.url))`) and in
  `vitest.config.mts`'s `server-only` alias, both in `youtube`. **The FL Studio
  clone must copy both patterns verbatim** — `turbopack.root` in
  `next.config.ts` and `fileURLToPath` (never `URL.pathname` or naive string
  paths) anywhere a config file resolves a path relative to `import.meta.url`.
  This was already true for every sibling under this repo root and isn't new to
  audio — restating it here because Lane 7's brief explicitly calls it out.
  **HIGH** — read directly from
  `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/youtube/vitest.config.mts`
  and `next.config.ts`.

The `FL Studio` folder's *own* internal space (as opposed to the parent path)
is an additional, not-yet-tested layer on top of that — same fix applies
(`fileURLToPath`), but confirm with an actual `pnpm dev`/`pnpm build`/Vercel
deploy once the project scaffolds, since this lane found no sibling precedent
for a project-folder-name space specifically. **LOW**, flagged as a
build-verification TODO for the implementing agent, not a lane-7 research gap.

---

## Summary (10 lines)

1. No SSR blocker: keep audio code in `"use client"` components, initialize
   `AudioContext` inside effects/handlers, never at module scope. `dynamic(...,
   { ssr: false })` not required for the standard pattern. **MED/HIGH**
2. Real constraint (not SSR): `AudioContext` starts `"suspended"` until a user
   gesture — needs an explicit transport "start" affordance in the UI. **HIGH**
3. jsdom has zero Web Audio support — test domain/scheduler logic against
   either `standardized-audio-context-mock` or a hand-rolled stub aliased in
   `vitest.config.mts` the same way `youtube` aliases `server-only`. **HIGH**
4. Prefer the hand-rolled stub unless the engine's `AudioContext` surface grows
   past ~5-6 node types; then adopt the maintained mock. **MED**
5. Playwright/Chromium CAN play real audio; `youtube`'s
   `--autoplay-policy=no-user-gesture-required` launch flag is directly
   reusable and already proven in this repo. **HIGH**
6. Playwright's Chromium actually starts `AudioContext` as `"running"` by
   default (opposite of real browsers) — permissive for e2e, not a blocker.
   **MED**
7. `public/` needs zero special handling for wav/mp3; only note is Next's
   default `max-age=0` caching — add a scoped `headers()` rule for
   `/samples/:path*` if lane 4 lands a larger sample kit. **HIGH/MED**
8. Tone.js, if adopted, is ~20 KB gzipped — not a deployment-relevant bundle
   concern either way; re-verify exact number at implementation time. **MED/LOW**
9. Vercel deployment is genuinely zero-config for this app — no DB, no API
   routes, matches every sibling's "static project, no env vars" pattern.
   **HIGH**
10. Real, must-copy risk from the brief: the repo's parent path already has a
    space and both `next.config.ts` (`turbopack.root`) and
    `vitest.config.mts` (`fileURLToPath`, never `URL.pathname`) in `youtube`
    fix it — copy verbatim; the `FL Studio` folder's own space is untested
    against a live Vercel deploy and should be verified empirically at
    implementation time, not assumed safe. **HIGH pattern / LOW novel-path claim**

**No real blocker found.** The sibling stack (Next 16 App Router, pnpm, Vercel,
Vitest + Playwright, Tailwind v4, pinned versions in §0) carries over with zero
audio-specific deviation — the only actions this lane recommends are (a) reuse
`youtube`'s exact `fileURLToPath`/`turbopack.root` space-safety pattern, (b)
reuse its exact Playwright autoplay launch flag, and (c) pick a jsdom mocking
strategy for `AudioContext` before lane-2/3 domain tests are written.
