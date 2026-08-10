"use client";

/**
 * Who appears to be calling.
 *
 * First card on the surface because it is the one that decides whether the
 * screen reads as a real call at a glance: name and photo are what every
 * competitor treats as table stakes, and reviewers break the illusion on caller
 * ID long before they break it on voice quality
 * (research/competitive-teardown.md §4 Q1).
 */

import { useSettings } from "@/components/app-shell/settings-provider";
import { Card, Field, PhotoPicker, TextField } from "@/components/ui";

export function CallerSection() {
  const { settings, update } = useSettings();
  const { caller } = settings;

  return (
    <Card title="Who's calling">
      <Field label="Name">
        {({ id, describedBy }) => (
          <TextField
            id={id}
            describedBy={describedBy}
            value={caller.name}
            maxLength={40}
            placeholder="Mum"
            onValueChange={(name) => update({ caller: { name } })}
            testId="setting-caller-name"
          />
        )}
      </Field>

      <Field
        label="Label"
        hint="The small line under the name on the call screen — “mobile”, “iPhone”, or how you know them."
      >
        {({ id, describedBy }) => (
          <TextField
            id={id}
            describedBy={describedBy}
            value={caller.label}
            maxLength={24}
            placeholder="mobile"
            onValueChange={(label) => update({ caller: { label } })}
            testId="setting-caller-label"
          />
        )}
      </Field>

      <Field
        label="Photo"
        control="group"
        hint="Stored on this device only. Pictures are resized before they are saved."
      >
        {({ id, labelId, describedBy }) => (
          <PhotoPicker
            id={id}
            labelId={labelId}
            describedBy={describedBy}
            value={caller.photo}
            monogram={caller.name}
            onValueChange={(photo) => update({ caller: { photo } })}
            testId="setting-caller-photo"
          />
        )}
      </Field>
    </Card>
  );
}
