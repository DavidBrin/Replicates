/**
 * The one place the public AI build flag is read.
 *
 * `NEXT_PUBLIC_VOICE_AI_ENABLED` gates two things that must never disagree: the
 * provider registry (which decides whether an AI call can be *started*) and the
 * settings UI (which decides whether the AI tier can be *chosen*). They used to
 * read it separately — the adapter from env, the settings screen from a
 * hard-coded `true` — so on a build with the flag on and a key configured the
 * option stayed grey and README step 5 was impossible to follow. One function,
 * imported by both, is what stops that recurring.
 *
 * This module deliberately lives outside `adapters/` so a component can import
 * it without reaching into an adapter (see the note in `lib/container.ts`), and
 * outside `config.ts` because that file is `server-only` and this value is
 * public by construction.
 *
 * The comparison is written as a literal member expression because that is what
 * Next inlines into the client bundle at build time; `process.env[NAME]` would
 * be an empty object property read in the browser.
 *
 * It carries no secret and grants no permission. The server routes stay the real
 * authority: with this `true` and no key configured, `/api/voice/*` still answers
 * `503 voice_unconfigured` and the call degrades to the scripted tier.
 */

/** The env var's *name*, for docs and error copy. Never used to read the value. */
export const AI_ENABLED_FLAG = "NEXT_PUBLIC_VOICE_AI_ENABLED";

export function isAiTierEnabledInBuild(): boolean {
  return process.env.NEXT_PUBLIC_VOICE_AI_ENABLED === "true";
}
