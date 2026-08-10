"use client";

/**
 * Puts the container on React context.
 *
 * The container is built in an effect rather than during render because every
 * adapter inside it touches a browser global. Before that effect runs — the
 * server render and the first client render, which must produce identical
 * markup or React screams about hydration — consumers get the inert server
 * container.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createBrowserContainer, createServerContainer, type Container } from "@/lib/container";

const ContainerContext = createContext<Container | null>(null);

export function ContainerProvider({
  children,
  /** Tests inject a container directly and skip the browser build entirely. */
  container,
}: {
  children: ReactNode;
  container?: Container;
}) {
  const fallback = useMemo(() => container ?? createServerContainer(), [container]);
  const [current, setCurrent] = useState<Container>(fallback);

  useEffect(() => {
    if (container) return;
    const browser = createBrowserContainer();
    setCurrent(browser);
    return () => browser.ringtone.dispose();
  }, [container]);

  return <ContainerContext.Provider value={current}>{children}</ContainerContext.Provider>;
}

export function useContainer(): Container {
  const container = useContext(ContainerContext);
  if (!container) {
    throw new Error("useContainer must be used inside a <ContainerProvider>.");
  }
  return container;
}

/**
 * True once the real browser container is in place. Anything that must not run
 * against the inert server container — starting a camera, unlocking audio —
 * waits on this.
 */
export function useIsClientContainer(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}
