"use client";

/**
 * Team settings: name, key, icon, colour, private, triage, estimation scale.
 *
 * ## The key is the one field with a consequence
 *
 * `issues.identifier` is derived at read time from `team.key + "-" + number`
 * and is never stored, so changing `ENG` to `PLAT` re-labels every issue in the
 * team without touching a row — and breaks every bookmark and every `ENG-4`
 * written in a comment. The field says so. The repository rejects a key that is
 * taken or malformed with a `ConflictError`, which the route turns into a 409
 * and this form shows inline rather than as a toast, because it is about the
 * field the cursor is in.
 *
 * ## Saving is explicit
 *
 * Unlike the project header, this form has a Save button. Blur-to-commit is
 * right for a title somebody is fixing in passing and wrong for a settings
 * screen with a destructive field on it: renaming a key by tabbing past it is
 * not a recoverable accident.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ESTIMATION_SCALES,
  type EstimationScale,
  type Team,
} from "@/domain/entities";
import { cn } from "@/lib/cn";

const SCALE_LABELS: Readonly<Record<EstimationScale, string>> = {
  notUsed: "Not used",
  exponential: "Exponential (1, 2, 4, 8, 16)",
  fibonacci: "Fibonacci (1, 2, 3, 5, 8)",
  linear: "Linear (1, 2, 3, 4, 5)",
  tShirt: "T-shirt (XS – XL)",
};

export type TeamSettingsView = Pick<
  Team,
  | "id"
  | "name"
  | "key"
  | "description"
  | "icon"
  | "color"
  | "private"
  | "triageEnabled"
  | "estimationScale"
>;

export interface TeamSettingsFormProps {
  team: TeamSettingsView;
  /** From `can()` on the server. A fact, never a role. */
  canEdit: boolean;
  canSetPrivate: boolean;
}

export function TeamSettingsForm({
  team,
  canEdit,
  canSetPrivate,
}: TeamSettingsFormProps) {
  const router = useRouter();
  // Seeded once. The page hands this component a `key` derived from the team's
  // settings, so a server refresh that changed any of them remounts it rather
  // than re-seeding state from an effect — which is what keeps `dirty` honest
  // after a save and after somebody else's edit lands.
  const [draft, setDraft] = useState<TeamSettingsView>(team);
  const [pending, setPending] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    draft.name !== team.name ||
    draft.key !== team.key ||
    draft.description !== team.description ||
    draft.color !== team.color ||
    draft.icon !== team.icon ||
    draft.private !== team.private ||
    draft.triageEnabled !== team.triageEnabled ||
    draft.estimationScale !== team.estimationScale;

  async function save(): Promise<void> {
    setPending(true);
    setInlineError(null);
    const result = await callApi(`/api/teams/${team.id}`, {
      method: "PATCH",
      body: {
        name: draft.name,
        key: draft.key,
        description: draft.description,
        icon: draft.icon,
        color: draft.color,
        private: draft.private,
        triageEnabled: draft.triageEnabled,
        estimationScale: draft.estimationScale,
      },
    });
    setPending(false);

    if (result.ok) {
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 2_000);
      router.refresh();
      return;
    }
    // A 409 is about a field on this form — the key is taken, or is not
    // 1–5 uppercase characters. Anything else is about the actor.
    if (result.failure.status === 409) setInlineError(result.failure.message);
    else setRefusal(refusalMessage(result.failure));
  }

  const fieldClass = cn(
    "h-8 rounded-[var(--radius-md)] border border-default bg-elevated px-2",
    "text-small text-primary focus:border-[var(--border-focus)] focus:outline-none",
    "disabled:cursor-not-allowed disabled:text-quaternary",
  );

  return (
    <form
      data-testid="team-settings"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="Shown in the sidebar and on every issue.">
          <Input
            aria-label="Team name"
            value={draft.name}
            disabled={!canEdit}
            onChange={(event) => {
              setDraft((current) => ({ ...current, name: event.target.value }));
            }}
          />
        </Field>

        <Field
          label="Identifier"
          hint="The prefix on every issue. Changing it re-labels them all."
        >
          <Input
            aria-label="Team identifier"
            value={draft.key}
            maxLength={5}
            disabled={!canEdit}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                key: event.target.value.toUpperCase(),
              }));
            }}
          />
        </Field>

        <Field label="Icon" hint="A name from the icon set, e.g. Cpu or Brush.">
          <Input
            aria-label="Team icon"
            value={draft.icon}
            disabled={!canEdit}
            onChange={(event) => {
              setDraft((current) => ({ ...current, icon: event.target.value }));
            }}
          />
        </Field>

        <Field label="Colour" hint="Used for the team's glyph and its board.">
          <input
            type="color"
            aria-label="Team colour"
            value={draft.color}
            disabled={!canEdit}
            onChange={(event) => {
              setDraft((current) => ({ ...current, color: event.target.value }));
            }}
            className="h-8 w-16 cursor-pointer rounded-[var(--radius-md)] border border-default bg-elevated p-1 disabled:cursor-not-allowed"
          />
        </Field>
      </div>

      <Field
        label="Description"
        hint="Optional. What this team is responsible for."
      >
        <Input
          aria-label="Team description"
          value={draft.description ?? ""}
          disabled={!canEdit}
          onChange={(event) => {
            setDraft((current) => ({
              ...current,
              description: event.target.value === "" ? null : event.target.value,
            }));
          }}
        />
      </Field>

      <Field
        label="Estimation"
        hint="Estimates are stored as integers; the scale is presentation."
      >
        <select
          aria-label="Estimation scale"
          value={draft.estimationScale}
          disabled={!canEdit}
          onChange={(event) => {
            setDraft((current) => ({
              ...current,
              estimationScale: event.target.value as EstimationScale,
            }));
          }}
          className={fieldClass}
        >
          {ESTIMATION_SCALES.map((scale) => (
            <option key={scale} value={scale}>
              {SCALE_LABELS[scale]}
            </option>
          ))}
        </select>
      </Field>

      <Toggle
        label="Private team"
        hint="Invisible to workspace members who are not in it."
        checked={draft.private}
        disabled={!canEdit || !canSetPrivate}
        onChange={(next) => {
          setDraft((current) => ({ ...current, private: next }));
        }}
      />

      <Toggle
        label="Triage"
        hint="New issues land in a Triage state instead of the default one."
        checked={draft.triageEnabled}
        disabled={!canEdit}
        onChange={(next) => {
          setDraft((current) => ({ ...current, triageEnabled: next }));
        }}
      />

      {inlineError === null ? null : (
        <p role="alert" className="text-small text-danger">
          {inlineError}
        </p>
      )}

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {saved ? (
            <span role="status" className="text-mini text-success">
              Saved
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-mini text-tertiary">
          You can see this team&rsquo;s settings but not change them.
        </p>
      )}

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-mini font-[var(--weight-medium)] text-tertiary">
        {label}
      </span>
      {children}
      <span className="text-micro text-quaternary">{hint}</span>
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-0.5 size-4 accent-[var(--accent)] disabled:cursor-not-allowed"
      />
      <span>
        <span className="block text-small text-primary">{label}</span>
        <span className="block text-micro text-quaternary">{hint}</span>
      </span>
    </label>
  );
}
