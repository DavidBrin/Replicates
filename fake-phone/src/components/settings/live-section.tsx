"use client";

/**
 * Live mode's identity and crowd.
 *
 * Same deterrent logic as the call, different claim: not "someone is coming for
 * me" but "a lot of people can see you right now" (SPEC §2.3). The numbers are
 * settings rather than constants because a plausible audience is
 * person-specific — 148 watchers reads as real for most people and absurd for
 * someone whose friends know they have never streamed in their life.
 */

import { useSettings } from "@/components/app-shell/settings-provider";
import { Card, Field, PhotoPicker, Stepper, TextField } from "@/components/ui";

export function LiveSection() {
  const { settings, update } = useSettings();
  const { live } = settings;

  return (
    <Card title="Live mode">
      <Field label="Username">
        {({ id, describedBy }) => (
          <TextField
            id={id}
            describedBy={describedBy}
            value={live.username}
            maxLength={30}
            placeholder="you"
            onValueChange={(username) => update({ live: { username } })}
            testId="setting-live-username"
          />
        )}
      </Field>

      <Field label="Avatar" control="group">
        {({ id, labelId, describedBy }) => (
          <PhotoPicker
            id={id}
            labelId={labelId}
            describedBy={describedBy}
            value={live.avatar}
            monogram={live.username}
            onValueChange={(avatar) => update({ live: { avatar } })}
            testId="setting-live-avatar"
          />
        )}
      </Field>

      <Field
        label="Watching at the start"
        hint="The count drifts upward from here once the stream begins."
      >
        {({ id, describedBy }) => (
          <Stepper
            id={id}
            describedBy={describedBy}
            value={live.viewers}
            min={0}
            max={9_999_999}
            step={10}
            onValueChange={(viewers) => update({ live: { viewers } })}
            testId="setting-live-viewers"
          />
        )}
      </Field>

      <Field
        label="Comments a minute"
        hint="How busy the comment stream looks. Set 0 for a silent audience."
      >
        {({ id, describedBy }) => (
          <Stepper
            id={id}
            describedBy={describedBy}
            value={live.commentsPerMinute}
            min={0}
            max={120}
            step={2}
            onValueChange={(commentsPerMinute) => update({ live: { commentsPerMinute } })}
            testId="setting-live-comment-rate"
          />
        )}
      </Field>
    </Card>
  );
}
