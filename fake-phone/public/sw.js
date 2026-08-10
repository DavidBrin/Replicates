/* eslint-disable no-undef */
/**
 * Service worker — offline support for a tool you might need with no signal.
 *
 * Strategy, and why:
 *   - Navigations are network-first with a cache fallback. Cache-first would
 *     pin an installed user to a stale build, and this app's whole surface is
 *     three routes.
 *   - Static assets are stale-while-revalidate: instant paint, updated in the
 *     background. The ringtone in particular must never wait on the network.
 *
 * Deliberately NOT here: push handling. Delayed background ringing needs a
 * backend holding subscriptions, and iOS Web Push cannot play a custom sound
 * anyway — it is listed as a known gap in the README rather than half-built.
 */

const VERSION = "fake-phone-v1";

/** The app's three routes. Precached as HTML *and* mined for their bundles. */
const ROUTES = ["/", "/home", "/live"];

const SHELL = [
  ...ROUTES,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
  "/audio/ringtone.wav",
  "/audio/connect.wav",
  "/audio/disconnect.wav",
];

/**
 * `src="…"` / `href="…"` in the precached HTML.
 *
 * Only the double-quoted attribute form, which is what the framework emits.
 * That is also what keeps the app's own serialised data out of the results:
 * inside those inline scripts the same markup appears escaped (`href=\"…\"`),
 * so the quote this pattern requires immediately after the `=` is not there.
 */
const ASSET_ATTRIBUTE = /(?:src|href)\s*=\s*"([^"]+)"/g;

/**
 * Precaches the shell, then the JS and CSS the shell needs to boot.
 *
 * The second half is not optional, and the reason is easy to miss: this worker
 * is registered on `load`, so the very first visit fetches every hashed
 * `/_next/` chunk *before* a worker controls the page — the `fetch` handler
 * below never sees them and never caches them. Precaching only the route HTML
 * therefore produces the worst possible offline state: the first offline
 * reopen serves a cached document whose scripts 404, so React never hydrates
 * and the user gets a dead black render of a phone with no working controls,
 * which is indistinguishable from a broken app at the moment they need it.
 *
 * The bundle filenames are content-hashed and unknowable from here, so they are
 * read out of the HTML we have just cached. Every entry is still added
 * independently: one 404 must never reject the install and leave the app with
 * no worker at all.
 */
async function precache() {
  const cache = await caches.open(VERSION);
  // `addAll` rejects the whole batch if any single request 404s, which would
  // leave the worker permanently uninstalled. Each entry is added independently
  // so a missing optional asset cannot break offline mode.
  await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));

  const assets = await buildAssets(cache);
  await Promise.all([...assets].map((url) => cache.add(url).catch(() => undefined)));
}

/** Same-origin `/_next/` URLs referenced by the route HTML already in `cache`. */
async function buildAssets(cache) {
  const found = new Set();

  await Promise.all(
    ROUTES.map(async (route) => {
      try {
        const response = await cache.match(route);
        if (!response) return;
        const html = await response.text();
        for (const [, value] of html.matchAll(ASSET_ATTRIBUTE)) {
          const url = new URL(value, self.location.origin);
          if (url.origin !== self.location.origin) continue;
          if (!url.pathname.startsWith("/_next/")) continue;
          found.add(url.pathname + url.search);
        }
      } catch {
        // One unreadable route must not cost us the other two.
      }
    }),
  );

  return found;
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the voice API: a stale AI reply is worse than no reply.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
