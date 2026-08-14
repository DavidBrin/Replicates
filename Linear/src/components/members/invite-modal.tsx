"use client";

/**
 * Inviting somebody, with no email provider in the deployment.
 *
 * The whole flow is one dialog with two states: a form, then the link the form
 * produced. There is no "sent" state because nothing is sent — `DECISIONS.md`
 * D11 records the trade, and this component is where a user meets it.
 *
 * ## Why the role list is filtered but the server still checks
 *
 * An admin cannot mint an owner (R1), and `createInvite` refuses it under the
 * workspace lock. The dropdown filters the options anyway, because offering a
 * choice that always fails is a worse experience than not offering it — but the
 * filtering is *cosmetic*, and deleting it would change nothing about who can
 * actually create an owner invite.
 */

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  WORKSPACE_ROLE_RANK,
  WORKSPACE_ROLES,
  type Team,
  type TeamId,
  type WorkspaceId,
  type WorkspaceRole,
} from "@/domain/entities";
import { cn } from "@/lib/cn";

import { InviteLink } from "./invite-link";
import { callApi, refusalMessage } from "./mutations";
import { WORKSPACE_ROLE_LABELS } from "./role-select";

interface CreatedInvite {
  readonly url: string;
}

export interface InviteControlProps {
  workspaceId: WorkspaceId;
  /** The actor's own role — the ceiling on what an invitation may grant. */
  actorRole: WorkspaceRole;
  teams: readonly Pick<Team, "id" | "key" | "name">[];
}

export function InviteControl({
  workspaceId,
  actorRole,
  teams,
}: InviteControlProps) {
  const router = useRouter();
  const emailId = useId();
  const roleId = useId();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [teamIds, setTeamIds] = useState<readonly TeamId[]>([]);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const grantable = WORKSPACE_ROLES.filter(
    (candidate) => WORKSPACE_ROLE_RANK[candidate] <= WORKSPACE_ROLE_RANK[actorRole],
  );

  function close(): void {
    setOpen(false);
    setCreated(null);
    setError(null);
    setEmail("");
    setRole("member");
    setTeamIds([]);
    // The members list gains a pending invitation row; nothing else on the
    // screen changed, so a refresh is cheaper than threading the new row up.
    router.refresh();
  }

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    const result = await callApi<CreatedInvite>("/api/invites", {
      method: "POST",
      body: {
        workspaceId,
        email: email.trim() === "" ? null : email.trim(),
        role,
        teamIds,
      },
    });
    setPending(false);
    if (result.ok) setCreated({ url: result.value.url });
    else setError(refusalMessage(result.failure));
  }

  return (
    <>
      <Button
        data-testid="invite-button"
        variant="primary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Invite people
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            data-testid="invite-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Invite people"
            className={cn(
              "w-full max-w-[460px] rounded-[var(--radius-xl)] border border-default",
              "bg-overlay p-4 shadow-[var(--shadow-high)]",
            )}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
            }}
          >
            <h2 className="text-regular font-[var(--weight-title)] text-primary">
              Invite people
            </h2>

            {created === null ? (
              <form
                className="mt-4 flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor={emailId}
                    className="text-mini font-[var(--weight-medium)] text-tertiary"
                  >
                    Email (optional)
                  </label>
                  <Input
                    id={emailId}
                    data-testid="invite-email"
                    type="email"
                    autoFocus
                    placeholder="someone@example.com"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                  />
                  <p className="text-mini text-tertiary">
                    A note for your own members list. Nothing is emailed, and the
                    address is not checked when the link is used.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor={roleId}
                    className="text-mini font-[var(--weight-medium)] text-tertiary"
                  >
                    Role
                  </label>
                  <select
                    id={roleId}
                    data-testid="invite-role"
                    value={role}
                    onChange={(event) => {
                      setRole(event.target.value as WorkspaceRole);
                    }}
                    className="h-8 rounded-[var(--radius-md)] border border-default bg-elevated px-2 text-small text-primary focus:border-[var(--border-focus)] focus:outline-none"
                  >
                    {grantable.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {WORKSPACE_ROLE_LABELS[candidate]}
                      </option>
                    ))}
                  </select>
                </div>

                {teams.length > 0 ? (
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="text-mini font-[var(--weight-medium)] text-tertiary">
                      Add to teams
                    </legend>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {teams.map((team) => {
                        const checked = teamIds.includes(team.id);
                        return (
                          <label
                            key={team.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-md)]",
                              "border px-2 py-1 text-mini transition-colors duration-[var(--speed-quick)]",
                              checked
                                ? "border-accent bg-accent-tint text-accent-text"
                                : "border-default text-secondary hover:border-strong",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => {
                                setTeamIds((current) =>
                                  current.includes(team.id)
                                    ? current.filter((id) => id !== team.id)
                                    : [...current, team.id],
                                );
                              }}
                            />
                            <span className="font-mono text-micro">{team.key}</span>
                            <span>{team.name}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-mini text-tertiary">
                      A guest sees only the teams they are added to, so an
                      invitation with no team leaves them with nothing to open.
                    </p>
                  </fieldset>
                ) : null}

                {error === null ? null : (
                  <p role="alert" className="text-small text-danger">
                    {error}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    data-testid="invite-submit"
                    variant="primary"
                    disabled={pending}
                  >
                    {pending ? "Creating…" : "Create invitation"}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                <InviteLink url={created.url} />
                <div className="flex justify-end">
                  <Button type="button" variant="secondary" onClick={close}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
