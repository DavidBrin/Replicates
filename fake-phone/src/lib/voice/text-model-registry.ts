/**
 * Picks the `TextModelClient` for the configured `AI_PROVIDER`.
 *
 * This is the one-line-per-vendor file. `openai` is listed in the env contract
 * (SPEC §3.4) and has no implementation yet; rather than silently falling back
 * to Anthropic — which would bill the wrong account and confuse anyone
 * debugging — it throws a typed `not_configured`.
 *
 * That throw is the *last* line of defence, not the first. `config.ts` lists the
 * providers this build can actually call (`IMPLEMENTED_AI_PROVIDERS`) and
 * `isConfigured` refuses such a deployment at the door, so the routes answer a
 * clean `503 voice_unconfigured` before a session is ever minted. Keep the two
 * in step: a new client here means a new entry there. Reaching this throw at
 * runtime means they drifted — which is why `/api/voice/turn` resolves the
 * client inside its SSE producer, where a throw still leaves as a typed frame
 * rather than an untyped 500.
 */

import "server-only";

import { createAnthropicTextClient } from "./anthropic-client";
import type { AiProviderId } from "./config";
import { type TextModelClient, VoiceModelError } from "./model-client";

export interface TextModelRegistryOptions {
  readonly fetchImpl?: typeof fetch;
}

export function resolveTextModelClient(
  provider: AiProviderId,
  options: TextModelRegistryOptions = {},
): TextModelClient {
  switch (provider) {
    case "anthropic":
      return createAnthropicTextClient({ fetchImpl: options.fetchImpl });
    case "openai":
      // Seam, not a stub: a future `openai-client.ts` exports
      // `createOpenAiTextClient` and replaces this line. Nothing else moves.
      throw new VoiceModelError(
        "not_configured",
        "AI_PROVIDER=openai has no client in this build.",
      );
  }
}
