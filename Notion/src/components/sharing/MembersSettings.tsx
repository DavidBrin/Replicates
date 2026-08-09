"use client";

/**
 * Workspace members settings modal.
 *
 * Reached from the sidebar's workspace switcher. Where `SharePopover` governs
 * one page, this governs the workspace roster, so it edits
 * `workspace.members` rather than `page.members`.
 *
 * As with the command palette, the dialog body mounts only while open so its
 * transient state (the invite draft, the filter) resets by construction.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Users, X } from "lucide-react";
import { Avatar } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives/Button";
import { Pill } from "@/components/primitives/Pill";
import { MEMBER_ROLES, type MemberRole } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { ROLE_LABELS, RoleSelect } from "./SharePopover";

export interface MembersSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened via "Invite members" rather than "Settings" — focus the input. */
  autoFocusInvite?: boolean;
}

export function MembersSettings({ open, onOpenChange, autoFocusInvite }: MembersSettingsProps) {
  // Only ever opened by a user gesture, so it never renders on the server.
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <MembersDialog onOpenChange={onOpenChange} autoFocusInvite={autoFocusInvite} />,
    document.body,
  );
}

function MembersDialog({
  onOpenChange,
  autoFocusInvite,
}: {
  onOpenChange: (open: boolean) => void;
  autoFocusInvite?: boolean;
}) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const users = useWorkspaceStore((s) => s.users);
  const inviteMember = useWorkspaceStore((s) => s.inviteMember);
  const setMemberRole = useWorkspaceStore((s) => s.setMemberRole);
  const removeMember = useWorkspaceStore((s) => s.removeMember);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("can_edit");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspace.members;
    return workspace.members.filter((member) => {
      const user = users[member.userId];
      return `${user?.name ?? ""} ${user?.email ?? ""}`.toLowerCase().includes(needle);
    });
  }, [query, users, workspace.members]);

  const submitInvite = () => {
    const value = email.trim();
    if (!value) return;
    inviteMember(value, role);
    setEmail("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 pt-[12vh]"
      style={{ background: "rgba(15, 15, 15, 0.4)" }}
      onPointerDown={(event) => {
        // Only a press that starts on the scrim dismisses — not one that began
        // inside the dialog and drifted out during a text selection.
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Workspace members"
        className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg"
        style={{ background: "var(--bac-ele)", boxShadow: "var(--shadow-menu)" }}
      >
        <header
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--bor-pri)" }}
        >
          <Users size={16} style={{ color: "var(--ico-sec)" }} />
          <h2 className="flex-1 text-sm font-medium" style={{ color: "var(--tex-pri)" }}>
            Members
            <span className="ml-2 font-normal" style={{ color: "var(--tex-ter)" }}>
              {workspace.members.length}
            </span>
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="flex h-6 w-6 items-center justify-center rounded-[4px] outline-hidden hover:bg-[var(--bac-int)]"
            style={{ color: "var(--ico-sec)" }}
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex items-center gap-2 px-4 py-3">
          <input
            autoFocus={autoFocusInvite}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitInvite();
            }}
            placeholder="Add people by email"
            className="min-w-0 flex-1 rounded-[4px] px-2 py-1.5 text-sm outline-hidden"
            style={{ background: "var(--bac-int)", color: "var(--tex-pri)" }}
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as MemberRole)}
            aria-label="Invite role"
            className="shrink-0 rounded-[4px] px-1.5 py-1.5 text-xs outline-hidden"
            style={{ background: "var(--bac-int)", color: "var(--tex-sec)" }}
          >
            {MEMBER_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={submitInvite} disabled={!email.trim()}>
            Invite
          </Button>
        </div>

        <div
          className="flex items-center gap-2 border-y px-4 py-2"
          style={{ borderColor: "var(--bor-pri)" }}
        >
          <Search size={14} style={{ color: "var(--ico-ter)" }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search members"
            className="w-full bg-transparent text-sm outline-hidden"
            style={{ color: "var(--tex-pri)" }}
          />
        </div>

        <div className="notion-scroller flex-1 overflow-y-auto py-1">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs" style={{ color: "var(--tex-ter)" }}>
              No members match that search.
            </p>
          ) : (
            rows.map((member) => {
              const user = users[member.userId];
              const isOwner = member.userId === workspace.ownerId;
              return (
                <div
                  key={member.userId}
                  className="flex items-center gap-3 px-4 py-2 transition-colors duration-100 hover:bg-[var(--bac-int)]"
                >
                  <Avatar user={user} size={28} pending={member.invitePending} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm" style={{ color: "var(--tex-pri)" }}>
                        {user?.name ?? "Unknown"}
                      </span>
                      {isOwner ? <Pill size="sm">Owner</Pill> : null}
                      {member.invitePending ? (
                        <Pill size="sm" color="yellow">
                          Pending
                        </Pill>
                      ) : null}
                    </div>
                    <div className="truncate text-xs" style={{ color: "var(--tex-ter)" }}>
                      {user?.email}
                    </div>
                  </div>
                  <RoleSelect
                    role={member.role}
                    // The owner is the only account guaranteed to be able to
                    // restore access, so it cannot be demoted or removed.
                    disabled={isOwner}
                    onChange={(next) => setMemberRole(member.userId, next)}
                    onRemove={isOwner ? undefined : () => removeMember(member.userId)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
