"use client";

import { useEffect } from "react";

/**
 * Registers the service worker after the page has settled.
 *
 * Registration is deferred to the `load` event so it never competes with the
 * first paint — on a cold boot the user is looking at a phone that is supposed
 * to already be ringing, and nothing may delay that frame.
 *
 * Skipped in development, where an active worker serves stale bundles and
 * produces confusing "my change didn't apply" behaviour.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration fails on insecure origins and in some private modes.
        // Offline support is a nice-to-have; the app works fully without it.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
