/**
 * A persona is *who is calling* — the caller's character, the half-conversation
 * they speak, and the seed used to brief an LLM when the AI tier is enabled.
 *
 * The type lives in `domain/` (pure, no catalog) while the catalog of actual
 * personas lives in `domain/persona-catalog.ts`. Splitting them means adding a
 * persona is a data change in one file, and means the voice providers can be
 * tested against a fixture persona without pulling in the real catalog.
 */

/**
 * One spoken line, followed by the silence where the *other* side of the call
 * would be talking.
 *
 * That pause is the whole trick. Research turned up no published scripts from
 * existing apps (research/ai-voice-architecture.md §4.1 — they all ship
 * pre-recorded audio), so the believability rules encoded here come from
 * general phone-call realism: short lines, never a monologue, a listening gap
 * after each one, and concrete proximity cues.
 */
export interface DialogueLine {
  readonly text: string;
  /** Silence after this line, standing in for the other person replying. */
  readonly pauseAfterMs: number;
}

export interface Persona {
  readonly id: string;
  /** Shown in the persona picker. */
  readonly title: string;
  /** One line of description for the picker. */
  readonly description: string;
  /** Suggested caller name when this persona is chosen; the user can override. */
  readonly suggestedCallerName: string;
  readonly suggestedCallerLabel: string;
  /** The scripted half-conversation, used by the scripted tier. */
  readonly script: readonly DialogueLine[];
  /**
   * Character brief for the AI tier. Never a full system prompt — the
   * non-negotiable safety guardrails are appended server-side so a persona can
   * never opt out of them (see `lib/voice/system-prompt.ts`).
   */
  readonly characterBrief: string;
  /** Preferred speech rate/pitch hints for the synthesizer, 1 = default. */
  readonly voiceHints?: { rate?: number; pitch?: number };
}

/** Total speaking time of a script, useful for sizing a call and for tests. */
export function scriptDurationMs(script: readonly DialogueLine[], msPerChar = 60): number {
  return script.reduce((total, line) => total + line.text.length * msPerChar + line.pauseAfterMs, 0);
}
