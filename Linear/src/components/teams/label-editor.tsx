"use client";

/**
 * Team labels.
 *
 * Two permissions, not one: `label.create` is granted to a plain team member
 * and `label.update_delete` is not (matrix rows 25 and 26). Creating a label is
 * work — you need one and you make one. Editing an existing label changes what
 * everybody else's saved filters match, which is administration. The buttons
 * follow the same split, and the server enforces it either way.
 *
 * Workspace-wide labels are shown but not editable here: they belong to every
 * team, so a team settings screen is the wrong place to rename one. The route
 * refuses a label whose `teamId` is not this team, which is what makes the
 * greying-out a hint rather than the rule.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LabelChip } from "@/components/ui/badge";
import type { Label } from "@/domain/entities";

const NEW_LABEL_COLOR = "#5e6ad2";

export interface LabelEditorProps {
  teamId: string;
  /** Both the team's own labels and the workspace-wide ones. */
  labels: readonly Label[];
  canCreate: boolean;
  canEdit: boolean;
}

export function LabelEditor({
  teamId,
  labels,
  canCreate,
  canEdit,
}: LabelEditorProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState(NEW_LABEL_COLOR);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function send(body: Record<string, unknown>): Promise<void> {
    const result = await callApi(`/api/teams/${teamId}`, {
      method: "POST",
      body,
    });
    if (result.ok) {
      router.refresh();
      return;
    }
    setRefusal(
      result.failure.status === 409
        ? result.failure.message
        : refusalMessage(result.failure),
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-small font-[var(--weight-title)] text-primary">
          Labels
        </h2>
        <p className="text-mini text-tertiary">
          Team labels apply to this team&rsquo;s issues. Workspace labels apply
          everywhere and are managed in workspace settings.
        </p>
      </div>

      <ul className="flex flex-col rounded-[var(--radius-lg)] border border-subtle">
        {labels.length === 0 ? (
          <li className="px-3 py-2 text-mini text-quaternary">No labels yet.</li>
        ) : (
          labels.map((label) => {
            const ownedByTeam = label.teamId === teamId;
            return (
              <li
                key={label.id}
                className="flex items-center gap-2.5 border-b border-subtle px-3 py-2 last:border-b-0"
              >
                <LabelChip name={label.name} color={label.color} />
                {ownedByTeam ? null : (
                  <span className="text-micro text-quaternary">Workspace</span>
                )}
                <span className="flex-1" />
                {canEdit && ownedByTeam ? (
                  <>
                    <input
                      type="color"
                      aria-label={`Colour for ${label.name}`}
                      value={label.color}
                      onChange={(event) => {
                        void send({
                          action: "updateLabel",
                          labelId: label.id,
                          color: event.target.value,
                        });
                      }}
                      className="size-6 cursor-pointer rounded-[var(--radius-sm)] border border-default bg-elevated p-0.5"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete label ${label.name}`}
                      onClick={() => {
                        void send({ action: "deleteLabel", labelId: label.id });
                      }}
                    >
                      Delete
                    </Button>
                  </>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      {canCreate ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed === "") return;
            setName("");
            void send({ action: "createLabel", name: trimmed, color });
          }}
        >
          <Input
            aria-label="New label name"
            placeholder="Label name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            containerClassName="flex-1"
          />
          <input
            type="color"
            aria-label="New label colour"
            value={color}
            onChange={(event) => {
              setColor(event.target.value);
            }}
            className="h-8 w-12 cursor-pointer rounded-[var(--radius-md)] border border-default bg-elevated p-1"
          />
          <Button type="submit" variant="secondary">
            Create label
          </Button>
        </form>
      ) : null}

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </section>
  );
}
