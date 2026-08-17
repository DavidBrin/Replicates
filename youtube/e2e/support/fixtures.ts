import { test as base, expect, type Page } from "@playwright/test";

/**
 * The shared fixtures, and the one that matters: a browser with no WebCodecs.
 *
 * ## Why the deletion is a fixture and not a project setting
 *
 * `playwright.config.ts` declares a `no-webcodecs` project and used to claim
 * the deletion happened "in `e2e/fallback.setup.ts`". No such file existed,
 * and no `dependencies` entry referenced it — so the project would have run
 * fallback specs against a browser that still had WebCodecs and quietly tested
 * the ordinary path a second time. Worse, it would have *passed*.
 *
 * It cannot be a project setting. `addInitScript` is a method on a context or
 * a page, and `use` has no hook for one. So the capability is a fixture that
 * fallback specs opt into by name, which also makes the opt-in visible in the
 * spec rather than inferred from its filename.
 *
 * ## Why deletion rather than a real browser
 *
 * Roughly one browser in twenty cannot encode in the page — Firefox on
 * Android, older Safari — and falls back to uploading the source untouched, to
 * be served as a single progressive rendition over HTTP `Range`. That is a
 * second upload path and a second playback path, and nothing in an ordinary
 * run touches either. Chasing a real browser that lacks the API means a second
 * browser in CI; deleting the constructors before any page script runs makes
 * feature detection genuinely fail in the browser already there.
 *
 * `addInitScript` is what makes it honest: it runs before *any* script on the
 * page, including Next's own bootstrap, so nothing has had a chance to capture
 * a reference first.
 */

export const test = base.extend<{ withoutWebCodecs: void }>({
  withoutWebCodecs: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        for (const name of [
          "VideoEncoder",
          "VideoDecoder",
          "AudioEncoder",
          "AudioDecoder",
          "VideoFrame",
          "EncodedVideoChunk",
          "AudioData",
          "EncodedAudioChunk",
        ]) {
          // `delete` rather than assigning undefined: `"VideoEncoder" in
          // window` is a legitimate detection and has to fail too.
          delete (globalThis as unknown as Record<string, unknown>)[name];
        }
      });
      await use();
    },
    { auto: false },
  ],
});

export { expect };

/**
 * Navigate, and let the assertions do the waiting.
 *
 * This began as `goto` followed by `waitForLoadState("networkidle")`, on the
 * reasoning that every page here streams — shell, `<Suspense>` fallback, then
 * the data — so asserting immediately races the fallback. The reasoning is
 * right and `networkidle` is the wrong instrument: **it never fires on this
 * app**. A media page keeps requests open by design, and Next's dev/prod
 * client keeps its own connection, so "500ms with no more than two connections
 * in flight" is a condition that simply does not arrive. Nineteen of
 * twenty-six specs timed out at thirty seconds against a server that was
 * serving them correctly.
 *
 * Playwright's `expect(locator)` already retries until its timeout, which
 * covers the streaming case properly and per-assertion rather than by waiting
 * for a global quiet that a video site never reaches. So this waits for the
 * document and nothing more.
 *
 * `domcontentloaded` rather than `load`: `load` waits on every image and the
 * poster frames are the slowest thing on the page, none of which any assertion
 * here depends on.
 */
export async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

/**
 * Sign in through the real form.
 *
 * Not by writing a session cookie directly: a fabricated cookie exercises the
 * cookie parser and skips `verifyCredentials`, `createSession` and the
 * `Set-Cookie` the route builds — which is most of what could be wrong. It
 * would also have hidden the fact that, until recently, **there was no way to
 * sign in at all**: every piece existed and nothing in the application called
 * any of it, so the product was permanently signed out and three separate
 * "does not persist" gaps were really one missing route.
 */
export async function signIn(
  page: Page,
  email = "ada@example.test",
  password = "e2e-password",
): Promise<void> {
  await page.goto("/signin", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  // The masthead swaps its whole right cluster when a session exists, so this
  // waits on the outcome rather than on a URL that changes either way.
  //
  // Scoped to the banner: the guide rail carries its own Sign in link, so an
  // unscoped locator matches two elements and fails strict mode for a reason
  // that has nothing to do with the session.
  // A **link**, not a button: Create points at /studio/upload, because the
  // product's menu of three options is two things this application does not
  // have (no live ingest adapter, no posts) beside one that it does.
  await expect(masthead(page).getByRole("link", { name: /create/i })).toBeVisible();
}

/** The masthead, as a scope. See the note in {@link signIn}. */
export function masthead(page: Page) {
  return page.getByRole("banner");
}

/** The corpus `src/adapters/db/seed-e2e.ts` writes, named once. */
export const FIXTURE = {
  channels: {
    fieldnotes: { handle: "fieldnotes", name: "Field Notes" },
    patchbay: { handle: "thepatchbay", name: "The Patch Bay" },
  },
  videos: {
    river: { id: "vid_e2e_0001", title: "Reading a river" },
    quietest: { id: "vid_e2e_0002", title: "The quietest hour" },
    cables: { id: "vid_e2e_0003", title: "Every cable in the rack" },
    solder: { id: "vid_e2e_0004", title: "Solder joint, close up" },
    frost: { id: "vid_e2e_0005", title: "Frost, at speed" },
  },
} as const;
