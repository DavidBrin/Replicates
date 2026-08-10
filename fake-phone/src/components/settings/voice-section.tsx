"use client";

/**
 * What the caller sounds like, and who they are.
 *
 * The AI tier is rendered and described in both of its states, and which state
 * it is in is read from the build, never assumed. On a default build there is no
 * key, so the option is greyed with the reason written next to it: hiding it
 * would make the app look like it does less than it does, and showing it as if
 * it worked would be the "false information" App Store Guideline 1.1.6 exists to
 * punish (research/competitive-teardown.md §4 Q5).
 *
 * But a self-hoster who followed README "Enabling the AI tier" to the letter —
 * key set, `NEXT_PUBLIC_VOICE_AI_ENABLED=true`, rebuilt — has to be able to
 * complete step 5 and actually choose it. This section used to hard-code the
 * option as inert, which made that step impossible and quietly turned the
 * headline promise ("adding a key is the only step needed") into a false one.
 * The flag is read through `isAiTierEnabledInBuild()`, the same function the
 * provider registry gates on, so the switch and the door can never disagree.
 *
 * The server stays the authority either way: with the flag on and no working
 * key, `/api/voice/*` answers 503 and the call degrades to the scripted voice —
 * which is why the enabled note still mentions the key rather than promising it
 * works.
 *
 * The tier note lives inside the same container as the control because it is
 * part of the same statement — "here are your options, and here is the standing
 * of the one that depends on a server".
 */

import { useSettings } from "@/components/app-shell/settings-provider";
import { Card, Field, SegmentedControl, SelectField, type SegmentedOption } from "@/components/ui";
import { PERSONAS, getPersona } from "@/domain/persona-catalog";
import { VOICE_TIERS, type VoiceTier } from "@/domain/settings";
import { isAiTierEnabledInBuild } from "@/lib/voice/ai-tier-flag";

const TIER_LABELS: Record<VoiceTier, string> = {
  silent: "Silent",
  scripted: "Scripted",
  ai: "AI",
};

const TIER_NOTES: Record<VoiceTier, string> = {
  silent: "Ringtone, photo and a running timer. No voice — quiet, and the least that can go wrong.",
  scripted:
    "A written half-conversation, spoken aloud with the pauses where the other person would be talking.",
  ai: "A live conversation.",
};

/**
 * Both notes name the tier and name the key, because the e2e suite reads this
 * block as the app's answer to "what is the state of the AI tier" and because
 * either state is only half an answer without the other word.
 */
const AI_NOTES = {
  disabled:
    "AI is built in but unlit: it needs an API key configured on the server, so it cannot be chosen here.",
  enabled:
    "AI is switched on for this build. It still needs a working API key on the server — without one the call falls back to the scripted voice.",
} as const;

/** `ai` is present, and inert only while the build says the tier is off. */
function tierOptions(aiEnabled: boolean): readonly SegmentedOption<VoiceTier>[] {
  return VOICE_TIERS.map((tier) => ({
    value: tier,
    label: TIER_LABELS[tier],
    inert: tier === "ai" && !aiEnabled,
    testId: `setting-voice-tier-${tier}`,
  }));
}

export function VoiceSection() {
  const { settings, update } = useSettings();

  // Inlined at build time, so this is a literal comparison rather than a read —
  // no state, nothing to re-render on, and no round trip to ask the server.
  const aiEnabled = isAiTierEnabledInBuild();

  // Resolve through the catalog so a persona id left behind by an older build
  // still shows a real selection rather than an empty picker.
  const persona = getPersona(settings.personaId);

  return (
    <Card title="Voice">
      <Field label="How the caller speaks" control="group">
        {({ labelId }) => {
          const noteId = `${labelId}-note`;
          return (
            <div className="flex flex-col gap-2" data-testid="setting-voice-tier">
              <SegmentedControl
                labelId={labelId}
                describedBy={noteId}
                value={settings.voiceTier}
                options={tierOptions(aiEnabled)}
                onChange={(voiceTier) => update({ voiceTier })}
              />
              <p id={noteId} className="text-[12px] leading-snug text-text-secondary">
                {TIER_NOTES[settings.voiceTier]}
              </p>
              <p
                data-testid="setting-voice-tier-ai-note"
                className="text-[12px] leading-snug text-text-secondary/80"
              >
                {aiEnabled ? AI_NOTES.enabled : AI_NOTES.disabled}
              </p>
            </div>
          );
        }}
      </Field>

      <Field label="Who's on the other end" hint={persona.description}>
        {({ id, describedBy }) => (
          <SelectField
            id={id}
            describedBy={describedBy}
            value={persona.id}
            options={PERSONAS.map((entry) => ({ value: entry.id, label: entry.title }))}
            onValueChange={(personaId) => update({ personaId })}
            testId="setting-persona"
          />
        )}
      </Field>
    </Card>
  );
}
