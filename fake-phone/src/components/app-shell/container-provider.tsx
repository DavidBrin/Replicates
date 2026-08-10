"use client";

/**
 * Puts the container on React context.
 *
 * The browser container is a module-level lazy singleton rather than component
 * state. There is exactly one app per document, its adapters own long-lived
 * resources (an unlocked `<audio>` element, a wake-lock sentinel), and those
 * must survive any remount — losing the unlocked audio element on a route
 * change would silently mute the next call. Building it at module scope also
 * makes it immune to React 19's double-invoked renders in development, which a
 * `useState` initializer would not be: that would construct two audio elements
 * and keep one.
 *
 * Which container a render sees is decided by `useIsClientContainer()`, so the
 * server render and the hydrating client render agree, and the real one swaps
 * in on the first post-hydration render.
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import { createBrowserContainer, createServerContainer, type Container } from "@/lib/container";

const ContainerContext = createContext<Container | null>(null);

let browserContainer: Container | null = null;

function getBrowserContainer(): Container {
  browserContainer ??= createBrowserContainer();
  return browserContainer;
}

let serverContainer: Container | null = null;

function getServerContainer(): Container {
  serverContainer ??= createServerContainer();
  return serverContainer;
}

export function ContainerProvider({
  children,
  /** Tests inject a container directly and skip the browser build entirely. */
  container,
}: {
  children: ReactNode;
  container?: Container;
}) {
  const isClient = useIsClientContainer();
  const value = container ?? (isClient ? getBrowserContainer() : getServerContainer());

  return <ContainerContext.Provider value={value}>{children}</ContainerContext.Provider>;
}

export function useContainer(): Container {
  const container = useContext(ContainerContext);
  if (!container) {
    throw new Error("useContainer must be used inside a <ContainerProvider>.");
  }
  return container;
}

// `useSyncExternalStore` with a store that never changes is the supported way
// to ask "has hydration finished?". It returns the server snapshot during SSR
// and the hydrating render, then the client snapshot immediately afterwards —
// without the setState-in-an-effect that the naive version of this hook needs,
// and without risking a hydration mismatch.
const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * True once the real browser container is in place. Anything that must not run
 * against the inert server container — starting a camera, unlocking audio —
 * waits on this.
 */
export function useIsClientContainer(): boolean {
  return useSyncExternalStore(neverChanges, onClient, onServer);
}
