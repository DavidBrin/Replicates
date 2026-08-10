"use client";

/**
 * Which phone the call screen pretends to be.
 *
 * Worth a whole card despite being one control: "it looks like an in-app screen
 * rather than the real system call UI" is the second thing reviewers break
 * these apps on (research/competitive-teardown.md §4 Q1), and picking the skin
 * that matches the phone in your hand is the entire fix.
 */

import { useSettings } from "@/components/app-shell/settings-provider";
import { Card, Field, SegmentedControl, type SegmentedOption } from "@/components/ui";
import { CALL_SKINS, type CallSkin } from "@/domain/settings";

const SKIN_LABELS: Record<CallSkin, string> = {
  ios: "iPhone",
  android: "Android",
};

const SKIN_OPTIONS: readonly SegmentedOption<CallSkin>[] = CALL_SKINS.map((skin) => ({
  value: skin,
  label: SKIN_LABELS[skin],
  testId: `setting-skin-${skin}`,
}));

export function LookSection() {
  const { settings, update } = useSettings();

  return (
    <Card title="Look">
      <Field
        label="Call screen"
        control="group"
        hint="Match the phone you are holding — a mismatched call screen is the first thing anyone notices."
      >
        {({ labelId, describedBy }) => (
          <SegmentedControl
            labelId={labelId}
            describedBy={describedBy}
            value={settings.skin}
            options={SKIN_OPTIONS}
            onChange={(skin) => update({ skin })}
            testId="setting-skin"
          />
        )}
      </Field>
    </Card>
  );
}
