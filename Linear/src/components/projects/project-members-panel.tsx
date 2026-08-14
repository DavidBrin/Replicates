"use client";

/**
 * Project membership — the panel where this clone's one deliberate divergence
 * from Linear is actually operated.
 *
 * In Linear, adding somebody here changes who gets notified. Here it grants
 * them edit on the project and on its issues (`DECISIONS.md` D8), which makes
 * this control a privilege grant and is why the copy says so out loud rather
 * than leaving it to be discovered.
 *
 * ## The picker is hand-rolled, and that is a testability decision
 *
 * `components/ui/combobox.tsx` is better at this — fuzzy matching, keyboard
 * loop, popover placement. What it does not do is stamp
 * `data-testid="picker-option-{value}"` on its options, and `e2e/README.md`
 * makes that id part of the contract for every picker in the app. Adding the id
 * to the design system is the right long-term fix and belongs to whoever owns
 * that file; until then this panel renders its own list rather than shipping a
 * screen the suite cannot drive.
 *
 * Removal is immediate and un-confirmed, unlike a workspace removal. It takes
 * away one grant and is undone by clicking the same person's name again — a
 * confirmation dialog for that is friction pretending to be safety.
 *
 * ## Optimistic, but never *silently* optimistic
 *
 * The row appears before the server has been asked, and until the server
 * answers this panel says so: the section carries `data-pending="true"` and the
 * row is tinted and `aria-busy`, the same way an optimistic issue row is
 * (`components/issues/issue-row.tsx`). Without that, "sent" and "saved" look
 * identical, which is how a grant that never reached the database gets read as
 * one that did — and it leaves nothing for a test, or a person, to wait on.
 * `e2e/permissions.spec.ts` waits for `data-pending` to clear before it treats
 * the grant as real.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { callApi, refusalMessage } from "@/components/members/mutations";
import { RefusalToast } from "@/components/members/refusal-toast";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROJECT_ROLE_RANK } from "@/domain/policy";
import { cn } from "@/lib/cn";

import type {
  PersonView,
  ProjectAbilities,
  ProjectMemberView,
} from "./types";

export interface ProjectMembersPanelProps {
  projectId: string;
  members: readonly ProjectMemberView[];
  /** Workspace members not already on the project. */
  candidates: readonly PersonView[];
  abilities: ProjectAbilities;
}

export function ProjectMembersPanel({
  projectId,
  members,
  candidates,
  abilities,
}: ProjectMembersPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<readonly PersonView[]>([]);
  const [removed, setRemoved] = useState<readonly string[]>([]);
  /** Ids whose write has been sent and not yet answered. */
  const [pending, setPending] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    // An optimistic entry is dropped the moment the refreshed props carry the
    // real one. Keeping both renders the person twice under the same React key,
    // which is a duplicated row and an "Encountered two children with the same
    // key" error the first time `router.refresh()` lands.
    const known = new Set(members.map((member) => member.id));
    const optimistic: ProjectMemberView[] = added
      .filter((person) => !known.has(person.id))
      .map((person) => ({ ...person, role: "member" }));
    return [...members, ...optimistic].filter(
      (member) => !removed.includes(member.id),
    );
  }, [members, added, removed]);

  const selectable = useMemo(() => {
    const taken = new Set(shown.map((member) => member.id));
    const needle = query.trim().toLowerCase();
    return candidates
      .filter((person) => !taken.has(person.id))
      .filter(
        (person) =>
          needle === "" ||
          person.name.toLowerCase().includes(needle) ||
          person.email.toLowerCase().includes(needle),
      );
  }, [candidates, shown, query]);

  const settle = (id: string): void => {
    setPending((current) => current.filter((entry) => entry !== id));
  };

  async function add(person: PersonView): Promise<void> {
    // One unanswered write per person. A second grant fired while the first is
    // still in flight is two rows the server will reconcile in whatever order
    // it happens to run them.
    if (pending.includes(person.id)) return;

    setOpen(false);
    setQuery("");
    setAdded((current) => [...current, person]);
    setPending((current) => [...current, person.id]);

    const result = await callApi(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: { userId: person.id, role: "member" },
    });
    if (result.ok) {
      router.refresh();
      settle(person.id);
      return;
    }
    setAdded((current) => current.filter((entry) => entry.id !== person.id));
    settle(person.id);
    setRefusal(refusalMessage(result.failure));
  }

  async function remove(member: ProjectMemberView): Promise<void> {
    if (pending.includes(member.id)) return;

    setRemoved((current) => [...current, member.id]);
    setPending((current) => [...current, member.id]);

    const result = await callApi(`/api/projects/${projectId}/members`, {
      method: "DELETE",
      body: { userId: member.id },
    });
    if (result.ok) {
      router.refresh();
      settle(member.id);
      return;
    }
    setRemoved((current) => current.filter((id) => id !== member.id));
    settle(member.id);
    setRefusal(refusalMessage(result.failure));
  }

  return (
    <section
      data-testid="project-members"
      // "Is there a grant on this panel the server has not answered yet?" —
      // the one question an optimistic row cannot be asked directly.
      data-pending={pending.length > 0 ? "true" : "false"}
      ref={container}
      className="flex flex-col gap-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-mini font-[var(--weight-medium)] text-tertiary">
          Members
        </h2>
        {abilities.canAddMember ? (
          <div className="relative">
            <Button
              data-testid="project-add-member"
              variant="ghost"
              size="sm"
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
                aria-label="Add a project member"
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
                      Everyone in this workspace is already here.
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
                          className={cn(
                            "flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5",
                            "text-left text-small text-primary hover:bg-hover",
                          )}
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

      <ul className="flex flex-col">
        {shown.length === 0 ? (
          <li className="py-2 text-mini text-tertiary">Nobody yet.</li>
        ) : (
          shown.map((member) => (
            <li
              key={member.id}
              data-testid={`project-member-${member.email}`}
              data-pending={pending.includes(member.id) ? "true" : "false"}
              aria-busy={pending.includes(member.id)}
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius-md)] px-1 py-1.5 hover:bg-hover",
                // A tint, never a spinner: the unacknowledged row has to occupy
                // the same box as the confirmed one (§6.5, rule 4).
                pending.includes(member.id) && "opacity-70",
              )}
            >
              <Avatar
                id={member.id}
                name={member.name}
                src={member.avatarUrl}
                color={member.avatarColor}
                size={20}
                decorative
              />
              <span className="min-w-0 flex-1 truncate text-small text-primary">
                {member.name}
              </span>
              {PROJECT_ROLE_RANK[member.role] > PROJECT_ROLE_RANK.member ? (
                <span className="text-micro text-tertiary">Lead</span>
              ) : null}
              {abilities.canRemoveMember ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${member.name} from this project`}
                  // Revoking a grant that has not been granted yet is a race
                  // with no correct outcome; the control comes back the moment
                  // the server answers.
                  disabled={pending.includes(member.id)}
                  onClick={() => {
                    void remove(member);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>

      <p className="text-micro text-quaternary">
        Members of this project can edit it and its issues, even without being in
        its teams.
      </p>

      <RefusalToast
        message={refusal}
        onDismiss={() => {
          setRefusal(null);
        }}
      />
    </section>
  );
}
