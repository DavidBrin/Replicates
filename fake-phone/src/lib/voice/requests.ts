/**
 * Wire schemas for the voice routes.
 *
 * Every field is bounded. The turn route accepts a persona's `characterBrief`
 * straight off the wire — the persona catalog lives in the client bundle, so
 * the alternative is the server owning a second copy of it — which means a
 * caller can put anything they like in there. That is a *designed-for* input,
 * not a hole: `system-prompt.ts` wraps the brief as untrusted data and appends
 * the guardrails after it, and the length caps here stop the brief being used
 * as a way to spend someone else's token budget.
 */

import { z } from "zod";

export const sessionRequestSchema = z.object({
  /** Which persona the call will use. Opaque to the server. */
  personaId: z.string().trim().min(1).max(64),
  /** Optional client-generated id, echoed back for correlation in logs. */
  clientCallId: z.string().trim().max(128).optional(),
});

export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export const transcriptTurnSchema = z.object({
  role: z.enum(["caller", "user"]),
  text: z.string().trim().min(1).max(2000),
});

export const turnRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  persona: z.object({
    id: z.string().trim().min(1).max(64),
    title: z.string().trim().max(120).optional(),
    characterBrief: z.string().trim().min(1).max(4000),
  }),
  callerName: z.string().trim().min(1).max(40).default("A friend"),
  callerLabel: z.string().trim().max(40).default(""),
  /** Oldest first. Capped so a long call cannot grow the prompt without bound. */
  transcript: z.array(transcriptTurnSchema).max(60).default([]),
  /** Wall-clock seconds since the call connected, per the client's `Clock`. */
  elapsedSeconds: z.number().int().min(0).max(86_400).default(0),
  /** Output tokens spent so far this call, accumulated from `usage` frames. */
  tokensUsed: z.number().int().min(0).max(1_000_000).default(0),
});

export type TurnRequest = z.infer<typeof turnRequestSchema>;

/**
 * The most a single turn may spend, regardless of how much budget is left.
 *
 * One spoken line is a few dozen tokens; the headroom is for the model's own
 * thinking. Capping per-turn as well as per-call means a single bad turn cannot
 * burn the whole call's budget and cut the conversation dead.
 */
export const MAX_TOKENS_PER_TURN = 400;

/**
 * How close to the caps counts as "wrap it up".
 *
 * Ending a call mid-word reads as a crash; `research/ai-voice-architecture.md`
 * §6 is explicit that the harness should end the call *in persona*. These
 * margins are what let it.
 */
export const WRAP_UP_SECONDS = 20;
export const WRAP_UP_TOKENS = MAX_TOKENS_PER_TURN;
