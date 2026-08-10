"use client";

/**
 * Ringtone and subtitles.
 *
 * Subtitles default on and are worth keeping on: iOS speech synthesis is
 * unreliable enough — empty voice list until `voiceschanged`, speech cut when
 * backgrounded — that the call has to still read as real when no sound comes
 * out (research/web-platform-constraints.md §8, SPEC §4.5).
 */

import { useSettings } from "@/components/app-shell/settings-provider";
import { Card, Toggle } from "@/components/ui";

export function SoundSection() {
  const { settings, update } = useSettings();

  return (
    <Card title="Sound">
      <ToggleRow
        label="Ringtone"
        hint="Turn this off where a ring would draw the wrong kind of attention."
        checked={settings.ringtoneEnabled}
        onChange={(ringtoneEnabled) => update({ ringtoneEnabled })}
        testId="setting-ringtone"
      />
      <ToggleRow
        label="Subtitles"
        hint="Shows the caller's words on screen, so the call still reads as real if the voice does not play."
        checked={settings.showSubtitles}
        onChange={(showSubtitles) => update({ showSubtitles })}
        testId="setting-subtitles"
      />
    </Card>
  );
}

/**
 * A switch is the one control that reads better beside its label than under it,
 * so this row does not use `Field` — it wires the same ids by hand.
 */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  testId,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}) {
  const labelId = `${testId}-label`;
  const hintId = `${testId}-hint`;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span id={labelId} className="text-[13px] font-medium text-text-primary">
          {label}
        </span>
        <p id={hintId} className="text-[12px] leading-snug text-text-secondary">
          {hint}
        </p>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        labelId={labelId}
        describedBy={hintId}
        testId={testId}
      />
    </div>
  );
}
