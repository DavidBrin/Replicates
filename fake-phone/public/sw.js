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
const SHELL = [
  "/",
  "/home",
  "/live",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
  "/audio/ringtone.wav",
  "/audio/connect.wav",
  "/audio/disconnect.wav",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // `addAll` rejects the whole batch if any single request 404s, which
      // would leave the worker permanently uninstalled. Each entry is added
      // independently so a missing optional asset cannot break offline mode.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
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
