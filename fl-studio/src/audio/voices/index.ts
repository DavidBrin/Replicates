/**
 * The seven synthesis voices of SPEC.md §3.3, keyed by `VoiceKind`.
 *
 * The table is exhaustive by type: adding a `VoiceKind` to `domain/types.ts`
 * without adding its recipe here is a compile error, not a silent no-sound
 * channel.
 */

import type { VoiceBuilder, VoiceKind } from "../types";
import { createBass } from "./bass";
import { createClap } from "./clap";
import { createHatClosed, createHatOpen } from "./hats";
import { createKick } from "./kick";
import { createLead } from "./lead";
import { createSnare } from "./snare";

export const VOICE_BUILDERS: Record<VoiceKind, VoiceBuilder> = {
  kick: createKick,
  clap: createClap,
  hatClosed: createHatClosed,
  hatOpen: createHatOpen,
  snare: createSnare,
  bass: createBass,
  lead: createLead,
};

export function voiceBuilder(kind: VoiceKind): VoiceBuilder {
  return VOICE_BUILDERS[kind];
}

export { createBass, createClap, createHatClosed, createHatOpen, createKick, createLead, createSnare };
export * from "./shared";
