/**
 * Server-side voice configuration.
 *
 * This module is the ONLY place that decides whether the AI tier is live, and
 * it is marked `server-only` so that importing it from a component is a build
 * error rather than a key leak (SPEC §3.4). Nothing here ever returns a secret:
 * the config object carries a `hasApiKey` boolean, never the key itself, so a
 * careless `Response.json(config)` cannot exfiltrate anything. The key is read
 * exactly once, at the point of use, inside `anthropic-client.ts`.
 *
 * Parsing is *repairing*, never throwing — the same rule as `domain/settings.ts`
 * and for the same reason. A typo in `VOICE_CALL_MAX_TOKENS` must degrade to the
 * documented default and leave the app ringing, not take the whole route down.
 */

import "server-only";

import { z } from "zod";

import { MAX_TOKENS_PER_TURN, WRAP_UP_SECONDS, WRAP_UP_TOKENS } from "./requests";

/** Server-side kill switch / override. Absent, it is inferred from key presence. */
export const VOICE_PROVIDERS = ["scripted", "ai"] as const;
export type VoiceProviderSetting = (typeof VOICE_PROVIDERS)[number];

export const AI_PROVIDERS = ["anthropic", "openai"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/**
 * The providers that actually have a client in this build.
 *
 * `openai` is a declared seam in the env contract (SPEC §3.4) with no
 * implementation — see `text-model-registry.ts`. Naming that here, rather than
 * only inside the resolver, is what lets the routes refuse a `AI_PROVIDER=openai`
 * deployment at the door with the documented `503 voice_unconfigured` instead of
 * minting a session that every turn then fails to serve.
 *
 * A future `openai-client.ts` adds `"openai"` to this list and one line to the
 * resolver. Nothing else moves.
 */
export const IMPLEMENTED_AI_PROVIDERS: readonly AiProviderId[] = ["anthropic"] as const;

export function hasModelClient(provider: AiProviderId): boolean {
  return IMPLEMENTED_AI_PROVIDERS.includes(provider);
}

/**
 * The env var each provider's key lives in. Exported as *names*, never values —
 * callers that need the secret read `process.env` themselves, one line from the
 * `fetch` that uses it, so the key never travels through a return value.
 */
export const API_KEY_ENV_VARS: Readonly<Record<AiProviderId, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export const DEFAULT_MAX_DURATION_SECONDS = 240;
export const DEFAULT_MAX_TOKENS = 2000;

/**
 * Cost guardrails from `research/ai-voice-architecture.md` §6. The ceilings are
 * deliberately well under Vercel's 300s Hobby function cap (§2.4) so behaviour
 * is identical on every plan and a runaway call cannot outlive its function.
 *
 * The *floors* are derived from the wrap-up margins rather than picked, because
 * a budget smaller than its own margin is a budget that is spent before the call
 * starts: `/api/voice/turn` wraps up at `maxDuration - WRAP_UP_SECONDS` and at
 * `maxTokens - WRAP_UP_TOKENS`, so at 15s or 64 tokens the very first turn hit a
 * cap, the caller spoke the wrap-up line, and the model was never called at all.
 * Every accepted configuration must be able to place at least one real call —
 * hence "one full turn's worth *on top of* the margin" for both.
 */
const MIN_DURATION_SECONDS = WRAP_UP_SECONDS * 2;
const MAX_DURATION_SECONDS = 600;
const MIN_TOKENS = WRAP_UP_TOKENS + MAX_TOKENS_PER_TURN;
const MAX_TOKENS = 8000;

export type VoiceEnv = Readonly<Record<string, string | undefined>>;

export interface VoiceConfig {
  /** Which tier the server will actually serve. */
  readonly voiceProvider: VoiceProviderSetting;
  /** Which vendor the `ai` tier would call. Meaningless while unconfigured. */
  readonly aiProvider: AiProviderId;
  /** Whether the *selected* provider's key is present. Never the key. */
  readonly hasApiKey: boolean;
  readonly maxDurationSeconds: number;
  readonly maxTokens: number;
}

function boundedInt(min: number, max: number, fallback: number) {
  return z.coerce.number().int().min(min).max(max).catch(fallback);
}

const numbersSchema = z.object({
  VOICE_CALL_MAX_DURATION_SECONDS: boundedInt(
    MIN_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
    DEFAULT_MAX_DURATION_SECONDS,
  ),
  VOICE_CALL_MAX_TOKENS: boundedInt(MIN_TOKENS, MAX_TOKENS, DEFAULT_MAX_TOKENS),
});

const providerSchema = z.enum(VOICE_PROVIDERS).optional().catch(undefined);
const aiProviderSchema = z.enum(AI_PROVIDERS).catch("anthropic");

/** An unset var and an empty-string var mean the same thing: not configured. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readVoiceConfig(env: VoiceEnv = process.env): VoiceConfig {
  const aiProvider = aiProviderSchema.parse(present(env.AI_PROVIDER));
  const hasApiKey = present(env[API_KEY_ENV_VARS[aiProvider]]) !== undefined;

  /**
   * `VOICE_PROVIDER` is an *override*, not a prerequisite. With it unset the
   * tier is inferred from key presence, which is what makes "add a key" the
   * single step needed to light the AI tier up (SPEC §2.2). Setting it to
   * `scripted` is the kill switch: it wins even when a key is present.
   */
  const override = providerSchema.parse(present(env.VOICE_PROVIDER));
  const voiceProvider: VoiceProviderSetting = override ?? (hasApiKey ? "ai" : "scripted");

  const numbers = numbersSchema.parse({
    VOICE_CALL_MAX_DURATION_SECONDS: present(env.VOICE_CALL_MAX_DURATION_SECONDS),
    VOICE_CALL_MAX_TOKENS: present(env.VOICE_CALL_MAX_TOKENS),
  });

  return {
    voiceProvider,
    aiProvider,
    hasApiKey,
    maxDurationSeconds: numbers.VOICE_CALL_MAX_DURATION_SECONDS,
    maxTokens: numbers.VOICE_CALL_MAX_TOKENS,
  };
}

/**
 * False whenever the routes must answer `503 voice_unconfigured`.
 *
 * A key for a provider this build cannot call is not a configured deployment.
 * Saying so *here* is what makes `AI_PROVIDER=openai` fail fast and typed: the
 * session mint refuses instead of succeeding and leaving `/turn` to throw out of
 * the resolver before any SSE framing exists, which reached the browser as an
 * untyped framework 500.
 */
export function isConfigured(config: VoiceConfig): boolean {
  return config.voiceProvider === "ai" && config.hasApiKey && hasModelClient(config.aiProvider);
}

/**
 * A safe-to-log, safe-to-serve dump of the voice configuration.
 *
 * Every consumer that wants to *show* configuration goes through here, so there
 * is exactly one function to audit for leaks — and one function to test. It
 * reports whether a key exists, never any part of its value: not a prefix, not
 * a length, not a hash.
 */
export function describeVoiceConfig(env: VoiceEnv = process.env): Record<string, string> {
  const config = readVoiceConfig(env);
  return {
    VOICE_PROVIDER: config.voiceProvider,
    AI_PROVIDER: config.aiProvider,
    ANTHROPIC_API_KEY: redact(env.ANTHROPIC_API_KEY),
    OPENAI_API_KEY: redact(env.OPENAI_API_KEY),
    VOICE_CALL_MAX_DURATION_SECONDS: String(config.maxDurationSeconds),
    VOICE_CALL_MAX_TOKENS: String(config.maxTokens),
    configured: String(isConfigured(config)),
  };
}

function redact(value: string | undefined): string {
  return present(value) === undefined ? "unset" : "set (redacted)";
}
