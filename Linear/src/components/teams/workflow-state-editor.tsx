"use client";

/**
 * The workflow-state editor.
 *
 * States are grouped by *type*, because the type — not the name — is what the
 * application reasons about: which group a state sorts into, whether
 * `started_at` gets stamped, whether an issue counts as open. A team can have
 * three `started` states called anything it likes; it cannot have zero.
 *
 * ## What this screen refuses, and where the refusal lives
 *
 * Deleting the last state of a type, or one that still holds issues, is refused
 * by `POST /api/teams/{id}` with a 409 and a message naming the count. This
 * component shows that message and does not duplicate the rule — the count it
 * would need is the server's, and a client-side copy would be a second
 * implementation that disagrees the moment somebody files an issue in another
 * tab. The delete button therefore stays live and the refusal is the feedback,
 * which is the same shape as the last-owner rule on the members screen.
 *
 * ## Reordering writes one row
 *
 * `workflow_states.position` is a `double precision` and a move writes the
 * midpoint between its new neighbours — the float midpointing that
 * `DECISIONS.md` D4 rejects for *issue* ordering, kept here because a team has
 * a handful of states and will never exhaust a double's mantissa dragging
 * between them.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import {
  STATE_TYPES,
  type StateType,
  type WorkflowState,
} from "@/domain/entities";
import { cn } from "@/lib/cn";

const TYPE_LABELS: Readonly<Record<StateType, string>> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
};

const DEFAULT_COLORS: Readonly<Record<StateType, string>> = {
  triage: "#f2994a",
  backlog: "#bec2c8",
  unstarted: "#e2e2e2",
  started: "#f2c94c",
  completed: "#5e6ad2",
  canceled: "#95a2b3",
};

export interface WorkflowStateEditorProps {
  teamId: string;
  states: readonly WorkflowState[];
  canManage: boolean;
}

export function WorkflowStateEditor({
  teamId,
  states,
  canManage,
}: WorkflowStateEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [addingTo, setAddingTo] = useState<StateType | null>(null);
  const [newName, setNewName] = useState("");
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

  /**
   * The midpoint between the state's new neighbours.
   *
   * `Number.MAX_SAFE_INTEGER`-style edge cases do not arise: moving to the end
   * of a group takes `last + 1` rather than a midpoint with infinity, and
   * moving to the front takes `first - 1`.
   */
  function move(state: WorkflowState, direction: -1 | 1): void {
    const group = states.filter((candidate) => candidate.type === state.type);
    const index = group.findIndex((candidate) => candidate.id === state.id);
    const target = index + direction;
    if (target < 0 || target >= group.length) return;

    const neighbour = group[target];
    const beyond = group[target + direction];
    if (!neighbour) return;

    const position =
      beyond === undefined
        ? neighbour.position + direction
        : (neighbour.position + beyond.position) / 2;

    void send({ action: "updateState", stateId: state.id, position });
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-small font-[var(--weight-title)] text-primary">
          Workflow
        </h2>
        <p className="text-mini text-tertiary">
          Each status belongs to exactly one category. The category decides when
          an issue counts as started, done or cancelled.
        </p>
      </div>

      {STATE_TYPES.map((type) => {
        const group = states.filter((state) => state.type === type);
        if (group.length === 0 && !canManage) return null;

        return (
          <div key={type} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <h3 className="text-mini font-[var(--weight-medium)] text-tertiary">
                {TYPE_LABELS[type]}
              </h3>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Add a ${TYPE_LABELS[type]} status`}
                  onClick={() => {
                    setAddingTo(addingTo === type ? null : type);
                    setNewName("");
                  }}
                >
                  Add
                </Button>
              ) : null}
            </div>

            <ul className="flex flex-col rounded-[var(--radius-lg)] border border-subtle">
              {group.length === 0 ? (
                <li className="px-3 py-2 text-mini text-quaternary">
                  No {TYPE_LABELS[type].toLowerCase()} status.
                </li>
              ) : (
                group.map((state, index) => (
                  <li
                    key={state.id}
                    className="flex items-center gap-2.5 border-b border-subtle px-3 py-2 last:border-b-0"
                  >
                    <StatusIcon
                      type={state.type}
                      color={state.color}
                      label={state.name}
                      size={14}
                    />

                    {editing === state.id ? (
                      <form
                        className="flex flex-1 items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          setEditing(null);
                          if (draftName.trim() !== "" && draftName !== state.name) {
                            void send({
                              action: "updateState",
                              stateId: state.id,
                              name: draftName.trim(),
                            });
                          }
                        }}
                      >
                        <Input
                          autoFocus
                          aria-label={`Rename ${state.name}`}
                          value={draftName}
                          onChange={(event) => {
                            setDraftName(event.target.value);
                          }}
                          onBlur={() => {
                            setEditing(null);
                          }}
                          containerClassName="flex-1"
                        />
                      </form>
                    ) : (
                      <span className="flex-1 truncate text-small text-primary">
                        {state.name}
                      </span>
                    )}

                    {canManage ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          aria-label={`Colour for ${state.name}`}
                          value={state.color}
                          onChange={(event) => {
                            void send({
                              action: "updateState",
                              stateId: state.id,
                              color: event.target.value,
                            });
                          }}
                          className="size-6 cursor-pointer rounded-[var(--radius-sm)] border border-default bg-elevated p-0.5"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Rename ${state.name}`}
                          onClick={() => {
                            setEditing(state.id);
                            setDraftName(state.name);
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Move ${state.name} up`}
                          disabled={index === 0}
                          onClick={() => {
                            move(state, -1);
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Move ${state.name} down`}
                          disabled={index === group.length - 1}
                          onClick={() => {
                            move(state, 1);
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${state.name}`}
                          onClick={() => {
                            void send({
                              action: "deleteState",
                              stateId: state.id,
                            });
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))
              )}
            </ul>

            {addingTo === type ? (
              <form
                className={cn("flex items-center gap-2")}
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = newName.trim();
                  if (trimmed === "") return;
                  setAddingTo(null);
                  setNewName("");
                  void send({
                    action: "createState",
                    name: trimmed,
                    type,
                    color: DEFAULT_COLORS[type],
                  });
                }}
              >
                <Input
                  autoFocus
                  aria-label={`New ${TYPE_LABELS[type]} status name`}
                  placeholder="Status name"
                  value={newName}
                  onChange={(event) => {
                    setNewName(event.target.value);
                  }}
                  containerClassName="flex-1"
                />
                <Button type="submit" variant="secondary">
                  Create
                </Button>
              </form>
            ) : null}
          </div>
        );
      })}

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </section>
  );
}
