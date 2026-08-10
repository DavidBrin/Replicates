"use client";

/**
 * When the call arrives, and whether it answers itself.
 *
 * The caveat under the delay picker is the most important sentence on this
 * whole surface. "It doesn't ring if the screen is off" is the single most
 * repeated one-star complaint across this entire app category
 * (research/competitive-teardown.md §4 Q1, Q2): mobile Safari suspends JS
 * timers and audio the moment the screen locks, so a delayed call fired from a
 * browser tab in a pocket simply never happens. Native competitors promised it
 * anyway and got shredded for it.
 *
 * We cannot fix the platform, so we say so — permanently, not only once the
 * user has already chosen a delay. A visible limit is a limit the user can plan
 * around; a hidden one is a safety tool that failed silently at the worst
 * possible moment.
 */

import clsx from "clsx";

import { useSettings } from "@/components/app-shell/settings-provider";
import { Card, Field, SegmentedControl, Stepper, type SegmentedOption } from "@/components/ui";
import { RING_DELAYS_SECONDS } from "@/domain/settings";

type DelayValue = `${number}`;

const DELAY_OPTIONS: readonly SegmentedOption<DelayValue>[] = RING_DELAYS_SECONDS.map(
  (seconds) => ({
    value: String(seconds) as DelayValue,
    label: seconds === 0 ? "Now" : `${seconds}s`,
    testId: `setting-ring-delay-${seconds}`,
  }),
);

export function TimingSection() {
  const { settings, update } = useSettings();
  const delayed = settings.ringDelaySeconds > 0;

  return (
    <Card title="Timing">
      <Field label="Ring" control="group">
        {({ labelId }) => {
          const caveatId = `${labelId}-caveat`;
          return (
            <div className="flex flex-col gap-2">
              <SegmentedControl
                labelId={labelId}
                describedBy={caveatId}
                value={String(settings.ringDelaySeconds) as DelayValue}
                options={DELAY_OPTIONS}
                onChange={(value) => update({ ringDelaySeconds: Number(value) })}
                testId="setting-ring-delay"
              />
              <p
                id={caveatId}
                data-testid="ring-delay-caveat"
                className={clsx(
                  "text-[12px] leading-snug",
                  // Emphasised, never alarming: amber text, no icon, no red.
                  delayed ? "text-accent" : "text-text-secondary",
                )}
              >
                A delay only works while this screen stays on and in front of you. Phones pause
                timers and sound when they lock, so a call set to arrive later will not ring from
                your pocket.
              </p>
            </div>
          );
        }}
      </Field>

      <Field
        label="Answer by itself after"
        hint="Picks up on its own so you can start talking without looking at the phone. Set 0 to leave it ringing."
      >
        {({ id, describedBy }) => (
          <Stepper
            id={id}
            describedBy={describedBy}
            value={settings.autoAnswerSeconds}
            min={0}
            max={60}
            unit="seconds"
            onValueChange={(autoAnswerSeconds) => update({ autoAnswerSeconds })}
            testId="setting-auto-answer"
          />
        )}
      </Field>
    </Card>
  );
}
