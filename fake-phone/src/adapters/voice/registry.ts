/**
 * The voice-provider factory — the single place that decides which tier a call
 * actually gets.
 *
 * `createVoiceProvider` **never throws and never returns null** (SPEC §3.3). It
 * walks the requested tier down the chain `ai → scripted → silent`, taking the
 * first provider whose `isAvailable()` is true. Every step of that walk is a
 * property of this function, never a branch in the UI: a component asks for the
 * tier the user picked and receives something that works, without ever learning
 * that a key was missing.
 *
 * That is what lets the AI tier ship inert. With no key, `ai.isAvailable()` is
 * false, the walk lands on `scripted`, and the app behaves exactly as it does
 * today — no error path, no empty state, no special case.
 *
 * Construction is guarded too. A provider whose factory throws (a browser API
 * missing during SSR, a future provider doing something eager) is skipped as if
 * it were unavailable, and the last resort is an inert provider defined right
 * here — so even a total failure of every adapter still returns a usable object
 * rather than propagating a crash into a ringing phone.
 */

import type { VoiceTier } from "@/domain/settings";
import type { CallEvent, Clock, SpeechSynthesizer, VoiceProvider, VoiceSession } from "@/ports";

import { createAiVoiceProvider } from "./ai";
import { createScriptedVoiceProvider } from "./scripted";
import { createSilentVoiceProvider } from "./silent";

export interface VoiceDeps {
  speech: SpeechSynthesizer;
  clock: Clock;
}

/**
 * The degradation order, richest first. A tier's chain is this list from the
 * requested tier onward — `ai` may fall to `scripted` then `silent`; `scripted`
 * may fall to `silent`; `silent` is the floor and is always available.
 */
const TIER_ORDER: readonly VoiceTier[] = ["ai", "scripted", "silent"] as const;

type ProviderFactory = (deps: VoiceDeps) => VoiceProvider;

const FACTORIES: Readonly<Record<VoiceTier, ProviderFactory>> = {
  ai: (deps) => createAiVoiceProvider({ speech: deps.speech }),
  scripted: (deps) => createScriptedVoiceProvider(deps),
  silent: () => createSilentVoiceProvider(),
};

export function createVoiceProvider(tier: VoiceTier, deps: VoiceDeps): VoiceProvider {
  const start = TIER_ORDER.indexOf(tier);
  // An unknown tier (stale localStorage, a hand-edited settings blob) starts the
  // walk at the top rather than failing: `settings.ts` repairs rather than
  // throws, and this factory is held to the same standard.
  const chain = TIER_ORDER.slice(start === -1 ? 0 : start);

  for (const candidate of chain) {
    const provider = tryCreate(FACTORIES[candidate], deps);
    if (provider && isUsable(provider)) return provider;
  }

  return INERT_PROVIDER;
}

function tryCreate(factory: ProviderFactory, deps: VoiceDeps): VoiceProvider | null {
  try {
    return factory(deps);
  } catch {
    return null;
  }
}

/**
 * `isAvailable()` is contractually cheap and synchronous, but it is still
 * third-party code from this function's point of view — a provider that throws
 * from its own availability check is simply unavailable.
 */
function isUsable(provider: VoiceProvider): boolean {
  try {
    return provider.isAvailable();
  } catch {
    return false;
  }
}

/**
 * The floor beneath the floor.
 *
 * Only reachable if `createSilentVoiceProvider` itself fails, which should be
 * impossible — but "should be impossible" is not the same as "never returns
 * null", and this function promises the latter.
 */
const INERT_PROVIDER: VoiceProvider = {
  id: "silent",
  isAvailable: () => true,
  start: async (): Promise<VoiceSession> => ({
    events: (): AsyncIterable<CallEvent> => emptyCall(),
    stop: () => {},
  }),
};

async function* emptyCall(): AsyncGenerator<CallEvent> {
  yield { type: "connecting" };
  yield { type: "connected" };
  yield { type: "listening" };
}
