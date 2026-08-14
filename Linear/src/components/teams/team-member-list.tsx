"use client";

/**
 * Team membership, with role changes.
 *
 * Two rules are enforced on the server and surfaced here rather than
 * pre-empted:
 *
 * - **A guest can be in a team but never administer one** (R7). The select
 *   still offers Admin; the server refuses with `GUEST_CANNOT_HOLD_ROLE` and
 *   the row reverts. Filtering the option would mean this component knowing the
 *   target's *workspace* role and comparing it, which is the one thing
 *   `SPEC.md` §4 forbids outside the policy module.
 * - **The last admin cannot be demoted or removed** (R5). Same shape as the
 *   last-owner rule one level up, same reason: the count is only true inside
 *   the transaction that holds the team row lock.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEAM_ROLES, type TeamRole } from "@/domain/entities";
import { cn } from "@/lib/cn";

const TEAM_ROLE_LABELS: Readonly<Record<TeamRole, string>> = {
  admin: "Admin",
  member: "Member",
};

export interface TeamMemberView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly avatarColor: string;
  readonly role: TeamRole;
}

export interface TeamCandidateView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly avatarColor: string;
}

export interface TeamMemberListProps {
  teamId: string;
  members: readonly TeamMemberView[];
  /** Workspace members not already in the team. */
  candidates: readonly TeamCandidateView[];
  canManage: boolean;
}

export function TeamMemberList({
  teamId,
  members,
  candidates,
  canManage,
}: TeamMemberListProps) {
  const router = useRouter();
  const [roles, setRoles] = useState<Readonly<Record<string, TeamRole>>>({});
  const [removed, setRemoved] = useState<readonly string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const roleOf = (member: TeamMemberView): TeamRole =>
    roles[member.id] ?? member.role;

  const visible = members.filter((member) => !removed.includes(member.id));
  const taken = new Set(visible.map((member) => member.id));
  const needle = query.trim().toLowerCase();
  const selectable = candidates
    .filter((person) => !taken.has(person.id))
    .filter(
      (person) =>
        needle === "" ||
        person.name.toLowerCase().includes(needle) ||
        person.email.toLowerCase().includes(needle),
    );

  async function changeRole(
    member: TeamMemberView,
    next: TeamRole,
  ): Promise<void> {
    const previous = roleOf(member);
    setRoles((current) => ({ ...current, [member.id]: next }));

    const result = await callApi(`/api/teams/${teamId}/members`, {
      method: "PATCH",
      body: { userId: member.id, role: next },
    });
    if (result.ok) {
      router.refresh();
      return;
    }
    setRoles((current) => ({ ...current, [member.id]: previous }));
    setRefusal(refusalMessage(result.failure));
  }

  async function remove(member: TeamMemberView): Promise<void> {
    setRemoved((current) => [...current, member.id]);
    const result = await callApi(`/api/teams/${teamId}/members`, {
      method: "DELETE",
      body: { userId: member.id },
    });
    if (result.ok) {
      router.refresh();
      return;
    }
    setRemoved((current) => current.filter((id) => id !== member.id));
    setRefusal(refusalMessage(result.failure));
  }

  async function add(person: TeamCandidateView): Promise<void> {
    setOpen(false);
    setQuery("");
    const result = await callApi(`/api/teams/${teamId}/members`, {
      method: "POST",
      body: { userId: person.id, role: "member" },
    });
    if (result.ok) {
      router.refresh();
      return;
    }
    setRefusal(refusalMessage(result.failure));
  }

  return (
    <section data-testid="team-members" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-small font-[var(--weight-title)] text-primary">
            Members
          </h2>
          <p className="text-mini text-tertiary">
            Team members can create and edit this team&rsquo;s issues.
          </p>
        </div>
        {canManage ? (
          <div className="relative">
            <Button
              data-testid="team-add-member"
              variant="secondary"
              aria-expanded={open}
              aria-haspopup="listbox"
              onClick={() => {
                setOpen((current) => !current);
              }}
            >
              Add member
            </Button>
            {open ? (
              <div
                role="listbox"
                aria-label="Add a team member"
                className={cn(
                  "absolute right-0 top-[calc(100%+4px)] z-[var(--z-dropdown)] w-[260px]",
                  "rounded-[var(--radius-lg)] border border-default bg-overlay p-1",
                  "shadow-[var(--shadow-medium)]",
                )}
              >
                <div className="p-1">
                  <Input
                    autoFocus
                    placeholder="Search people…"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                  />
                </div>
                <ul className="max-h-[240px] overflow-y-auto">
                  {selectable.length === 0 ? (
                    <li className="px-2 py-3 text-center text-mini text-tertiary">
                      Everyone is already in this team.
                    </li>
                  ) : (
                    selectable.map((person) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          data-testid={`picker-option-${person.email}`}
                          onClick={() => {
                            void add(person);
                          }}
                          className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left text-small text-primary hover:bg-hover"
                        >
                          <Avatar
                            id={person.id}
                            name={person.name}
                            src={person.avatarUrl}
                            color={person.avatarColor}
                            size={20}
                            decorative
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{person.name}</span>
                            <span className="block truncate text-micro text-tertiary">
                              {person.email}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="flex flex-col rounded-[var(--radius-lg)] border border-subtle">
        {visible.length === 0 ? (
          <li className="px-3 py-2 text-mini text-quaternary">
            Nobody is in this team.
          </li>
        ) : (
          visible.map((member) => (
            <li
              key={member.id}
              data-testid={`team-member-${member.email}`}
              className="flex items-center gap-2.5 border-b border-subtle px-3 py-2 last:border-b-0"
            >
              <Avatar
                id={member.id}
                name={member.name}
                src={member.avatarUrl}
                color={member.avatarColor}
                size={20}
                decorative
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small text-primary">
                  {member.name}
                </span>
                <span className="block truncate text-micro text-tertiary">
                  {member.email}
                </span>
              </span>

              {canManage ? (
                <>
                  <select
                    aria-label={`Team role for ${member.name}`}
                    data-testid={`team-member-role-${member.email}`}
                    value={roleOf(member)}
                    onChange={(event) => {
                      void changeRole(member, event.target.value as TeamRole);
                    }}
                    className="h-7 rounded-[var(--radius-md)] border border-default bg-elevated px-2 text-mini text-primary focus:border-[var(--border-focus)] focus:outline-none"
                  >
                    {TEAM_ROLES.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {TEAM_ROLE_LABELS[candidate]}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${member.name} from this team`}
                    onClick={() => {
                      void remove(member);
                    }}
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-mini text-tertiary">
                  {TEAM_ROLE_LABELS[roleOf(member)]}
                </span>
              )}
            </li>
          ))
        )}
      </ul>

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </section>
  );
}
