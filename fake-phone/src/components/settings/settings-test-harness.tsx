/**
 * Test plumbing for the home and settings surfaces.
 *
 * These tests run against the *real* `SettingsProvider` with a fake container
 * injected, not against a mocked `useSettings`. That distinction is the whole
 * point: the interesting behaviour here — a patch being validated, an invalid
 * edit being dropped, a nested group merging rather than replacing — lives in
 * the provider, and a mocked hook would assert that the component calls a
 * function rather than that a setting actually got saved.
 *
 * The settings store below is a local in-memory implementation of the
 * `SettingsStore` port rather than the adapter package's `MemorySettingsStore`.
 * Components (and anything living under `src/components/`) may never import
 * from `src/adapters/` — that import direction is the rule that keeps the
 * layering real (SPEC §3.1) — and a test helper sitting inside a component
 * folder is not an exception worth carving.
 */

import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { ContainerProvider } from "@/components/app-shell/container-provider";
import { SettingsProvider } from "@/components/app-shell/settings-provider";
import { parseSettings, type Settings } from "@/domain/settings";
import type { Container } from "@/lib/container";
import type { SettingsStore } from "@/ports";

/** An in-memory `SettingsStore`; the assertions read straight out of it. */
export class TestSettingsStore implements SettingsStore {
  private current: Settings;

  constructor(seed: unknown = null) {
    this.current = parseSettings(seed);
  }

  load(): Settings {
    return this.current;
  }

  save(settings: Settings): void {
    this.current = settings;
  }

  clear(): void {
    this.current = parseSettings(null);
  }
}

/**
 * Every port except `settings` is inert. Nothing on this surface rings, speaks
 * or opens a camera, so a stub that does nothing is more honest than a mock
 * with expectations nobody checks.
 */
export function createTestContainer(settings: SettingsStore): Container {
  return {
    clock: { now: () => 0 },
    settings,
    ringtone: {
      unlock: async () => {},
      startRinging: async () => {},
      stopRinging: () => {},
      playCue: () => {},
      dispose: () => {},
    },
    speech: {
      isAvailable: () => false,
      warmUp: async () => {},
      speak: async () => {},
      cancel: () => {},
    },
    camera: {
      isSupported: () => false,
      start: async () => {
        throw new Error("No camera in tests.");
      },
      stop: () => {},
      flip: async () => {
        throw new Error("No camera in tests.");
      },
    },
    haptics: { isSupported: () => false, buzz: () => {}, cancel: () => {} },
    wakeLock: { isSupported: () => false, request: async () => {}, release: () => {} },
    voiceFor: () => ({
      id: "silent",
      isAvailable: () => true,
      start: async () => ({
        events: () => (async function* () {})(),
        stop: () => {},
      }),
    }),
  };
}

export interface SettingsHarness extends RenderResult {
  readonly store: TestSettingsStore;
  readonly user: ReturnType<typeof userEvent.setup>;
}

/** Renders `ui` inside the real provider stack over a seeded in-memory store. */
export function renderWithSettings(ui: ReactElement, seed: unknown = null): SettingsHarness {
  const store = new TestSettingsStore(seed);
  const container = createTestContainer(store);
  const user = userEvent.setup();

  const result = render(
    <ContainerProvider container={container}>
      <SettingsProvider>{ui}</SettingsProvider>
    </ContainerProvider>,
  );

  return { ...result, store, user };
}
