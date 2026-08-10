"use client";

/**
 * A single-line text input that saves on every keystroke.
 *
 * There is no Save button anywhere on this surface: someone configuring
 * fake-phone is preparing for a bad moment, and a lost edit is a real failure
 * (research/competitive-teardown.md §4 Q3 — all customisation happens *before*
 * the moment, never during it).
 *
 * Hence the local draft. `SettingsProvider.update` validates the merged result
 * and *drops* a patch that fails — which is right, because it means the stored
 * settings are never mid-edit garbage. But it means a controlled input bound
 * straight to the store cannot be emptied: clearing the caller name produces an
 * invalid patch, the store keeps the old name, and React snaps the old text
 * back under the cursor. Keeping the in-progress text locally lets the field be
 * cleared and retyped while the *stored* value only ever moves between valid
 * states. On blur the draft is dropped and the field shows what was actually
 * saved — an honest reveal rather than a field that lies about being empty.
 */

import clsx from "clsx";
import { useState } from "react";

export interface TextFieldProps {
  readonly id: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly describedBy?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly testId?: string;
  readonly autoComplete?: string;
}

export function TextField({
  id,
  value,
  onValueChange,
  describedBy,
  placeholder,
  maxLength,
  testId,
  autoComplete = "off",
}: TextFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      id={id}
      type="text"
      value={draft ?? value}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete={autoComplete}
      autoCorrect="off"
      spellCheck={false}
      aria-describedby={describedBy}
      data-testid={testId}
      onChange={(event) => {
        setDraft(event.target.value);
        onValueChange(event.target.value);
      }}
      onBlur={() => setDraft(null)}
      className={clsx(
        // 16px minimum, always. Mobile Safari zooms the whole page in on focus
        // for anything smaller, and the zoom does not come back out.
        "min-h-11 w-full rounded-xl border border-hairline bg-surface-2 px-3 text-base text-text-primary",
        "placeholder:text-text-secondary/60",
        "focus-visible:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      )}
    />
  );
}
