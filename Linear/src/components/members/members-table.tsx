"use client";

/**
 * Workspace membership, as a table you can actually administer from.
 *
 * Three behaviours here are the point of the whole slice:
 *
 * 1. **The role control is optimistic and reverts.** A change is applied to the
 *    row immediately and rolled back to the value the server still holds when
 *    the server refuses. Rolling back to "whatever it was before this click"
 *    rather than re-fetching matters for the last-owner case: the refusal and
 *    the reverted value have to be on screen at the same time, because together
 *    they are the explanation.
 * 2. **Removal asks twice.** Not for ceremony — a removal drops the person's
 *    team and project memberships too (R11), and that is not recoverable by
 *    re-adding them.
 * 3. **Nothing here decides who may do what.** Every control is live for every
 *    actor who reached this screen; the route handler asks `can()` and the
 *    membership service re-asks it under a row lock. A component that greys out
 *    a button is a hint, and this file deliberately contains none of them —
 *    which is also why the screen itself is unreachable for a plain member
 *    rather than rendered read-only.
 *
 * ## A row with an unanswered write is busy, not forbidden
 *
 * The one thing a control here *is* allowed to be disabled by is its own
 * in-flight request. That is not a permission decision — it is the difference
 * between "sent" and "saved", which an optimistic table otherwise hides
 * completely. Two consequences, and both are the point:
 *
 * - Nothing on this screen can claim a write landed before the server said so.
 *   The table carries `data-pending`, and `e2e/permissions.spec.ts` waits on it
 *   rather than on the optimistic value.
 * - A second action cannot overtake the first. Promoting somebody and then
 *   removing them are *ordered* operations — the removal's answer depends on
 *   the promotion having committed — and firing them together makes the outcome
 *   a coin toss decided by which request the server happens to finish first.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type {
  UserId,
  WorkspaceId,
  WorkspaceRole,
} from "@/domain/entities";
import { cn } from "@/lib/cn";

import { callApi, refusalMessage } from "./mutations";
import { RefusalToast } from "./refusal-toast";
import { RoleSelect } from "./role-select";

export interface MemberRow {
  readonly userId: UserId;
  readonly email: string;
  readonly name: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly avatarColor: string;
  readonly role: WorkspaceRole;
  readonly joinedAt: string;
  readonly active: boolean;
}

export interface MembersTableProps {
  workspaceId: WorkspaceId;
  members: readonly MemberRow[];
  /** Used only to label the actor's own row; never to decide a permission. */
  currentUserId: UserId;
}

interface Pending {
  readonly member: MemberRow;
}

export function MembersTable({
  workspaceId,
  members,
  currentUserId,
}: MembersTableProps) {
  const router = useRouter();
  /** Role overrides applied optimistically, keyed by user. */
  const [roles, setRoles] = useState<Readonly<Record<string, WorkspaceRole>>>({});
  const [removed, setRemoved] = useState<readonly string[]>([]);
  /** Users whose write has been sent and not yet answered. */
  const [pending, setPending] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const clearRefusal = useCallback(() => {
    setRefusal(null);
  }, []);

  const roleOf = (member: MemberRow): WorkspaceRole =>
    roles[member.userId] ?? member.role;

  const settle = (userId: string): void => {
    setPending((current) => current.filter((entry) => entry !== userId));
  };

  async function changeRole(
    member: MemberRow,
    next: WorkspaceRole,
  ): Promise<void> {
    if (pending.includes(member.userId)) return;

    const previous = roleOf(member);
    setRoles((current) => ({ ...current, [member.userId]: next }));
    setPending((current) => [...current, member.userId]);
    setRefusal(null);

    const result = await callApi(`/api/workspaces/${workspaceId}/members`, {
      method: "PATCH",
      body: { userId: member.userId, role: next },
    });

    if (result.ok) {
      router.refresh();
      settle(member.userId);
      return;
    }
    setRoles((current) => ({ ...current, [member.userId]: previous }));
    settle(member.userId);
    setRefusal(refusalMessage(result.failure));
  }

  async function remove(member: MemberRow): Promise<void> {
    if (pending.includes(member.userId)) return;

    setConfirming(null);
    setRemoved((current) => [...current, member.userId]);
    setPending((current) => [...current, member.userId]);
    setRefusal(null);

    const result = await callApi(`/api/workspaces/${workspaceId}/members`, {
      method: "DELETE",
      body: { userId: member.userId },
    });

    if (result.ok) {
      router.refresh();
      settle(member.userId);
      return;
    }
    setRemoved((current) => current.filter((id) => id !== member.userId));
    settle(member.userId);
    setRefusal(refusalMessage(result.failure));
  }

  const visible = members.filter((member) => !removed.includes(member.userId));

  return (
    <>
      <table
        data-testid="members-table"
        // "Is there a change on this table the server has not answered yet?"
        data-pending={pending.length > 0 ? "true" : "false"}
        className="w-full border-collapse text-small"
      >
        <thead>
          <tr className="border-b border-subtle text-left text-mini text-tertiary">
            <th scope="col" className="py-2 font-[var(--weight-medium)]">
              Member
            </th>
            <th scope="col" className="py-2 font-[var(--weight-medium)]">
              Role
            </th>
            <th scope="col" className="py-2 text-right font-[var(--weight-medium)]">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((member) => (
            <tr
              key={member.userId}
              data-testid={`member-row-${member.email}`}
              data-pending={pending.includes(member.userId) ? "true" : "false"}
              aria-busy={pending.includes(member.userId)}
              className={cn(
                "border-b border-subtle last:border-b-0",
                // A tint, never a spinner: an unacknowledged row keeps its box.
                pending.includes(member.userId) && "opacity-70",
              )}
            >
              <td className="py-2.5 pr-4">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    id={member.userId}
                    name={member.name}
                    src={member.avatarUrl}
                    color={member.avatarColor}
                    size={24}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-primary">{member.name}</span>
                      {member.userId === currentUserId ? (
                        <span className="text-micro text-quaternary">(you)</span>
                      ) : null}
                      {member.active ? null : (
                        <span className="text-micro text-warning">suspended</span>
                      )}
                    </div>
                    <div className="truncate text-mini text-tertiary">
                      {member.email}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-2.5 pr-4">
                <RoleSelect
                  testId={`member-role-${member.email}`}
                  label={`Workspace role for ${member.name}`}
                  value={roleOf(member)}
                  // Busy, not forbidden — see the note at the top of the file.
                  disabled={pending.includes(member.userId)}
                  onChange={(next) => {
                    void changeRole(member, next);
                  }}
                />
              </td>
              <td className="py-2.5 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  // The accessible name carries the person's name on purpose:
                  // the confirmation dialog's button is named exactly "Remove",
                  // and two buttons that both answer to `^remove$` would make
                  // every assertion on either of them ambiguous.
                  aria-label={`Remove ${member.name}`}
                  // A removal whose answer depends on a role change still in
                  // flight is a coin toss; the button returns when it lands.
                  disabled={pending.includes(member.userId)}
                  onClick={() => {
                    setConfirming({ member });
                  }}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {confirming === null ? null : (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-black/50 p-4 pt-[16vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirming(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Remove member"
            className={cn(
              "w-full max-w-[420px] rounded-[var(--radius-xl)] border border-default",
              "bg-overlay p-4 shadow-[var(--shadow-high)]",
            )}
          >
            <h2 className="text-regular font-[var(--weight-title)] text-primary">
              Remove {confirming.member.name}?
            </h2>
            <p className="mt-2 text-small text-secondary">
              They lose this workspace and every team and project in it. Issues
              and comments they wrote stay where they are.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  void remove(confirming.member);
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      <RefusalToast message={refusal} onDismiss={clearRefusal} />
    </>
  );
}
