"use client";

/**
 * What the caller sounds like, and who they are.
 *
 * The AI tier is rendered, described, and unselectable. That is a deliberate
 * product decision, not an oversight: the provider, the registry entry, the
 * route handlers and the env contract all ship (SPEC §2.2, §3.3), and the only
 * missing piece is a key that a self-hoster can add. Hiding the option would
 * make the app look like it does less than it does; showing it as if it worked
 * would be the "false information" that App Store Guideline 1.1.6 exists to
 * punish (research/competitive-teardown.md §4 Q5). So it sits there, greyed,
 * with the reason written next to it.
 *
 * The tier note lives inside the same container as the control because it is
 * part of the same statement — "here are your options, and here is why one of
 * them is dark".
 */

import { useSettings } from "@/components/app-shell/settings-provider";
import { Card, Field, SegmentedControl, SelectField, type SegmentedOption } from "@/components/ui";
import { PERSONAS, getPersona } from "@/domain/persona-catalog";
import { VOICE_TIERS, type VoiceTier } from "@/domain/settings";

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

/** `ai` is present but inert until a key is configured on the server. */
const TIER_OPTIONS: readonly SegmentedOption<VoiceTier>[] = VOICE_TIERS.map((tier) => ({
  value: tier,
  label: TIER_LABELS[tier],
  inert: tier === "ai",
  testId: `setting-voice-tier-${tier}`,
}));

export function VoiceSection() {
  const { settings, update } = useSettings();

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
                options={TIER_OPTIONS}
                onChange={(voiceTier) => update({ voiceTier })}
              />
              <p id={noteId} className="text-[12px] leading-snug text-text-secondary">
                {TIER_NOTES[settings.voiceTier]}
              </p>
              <p
                data-testid="setting-voice-tier-ai-note"
                className="text-[12px] leading-snug text-text-secondary/80"
              >
                AI is built in but unlit: it needs an API key configured on the server, so it
                cannot be chosen here.
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
