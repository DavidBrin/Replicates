"use client";

/**
 * The Share surface, anchored to the top bar's Share button.
 *
 * Two tabs, matching Notion: per-person access ("Share") and anonymous
 * read-only access ("Publish"). Publish is behind a feature flag because a
 * deployment without public hosting should not advertise a public URL.
 */

import { useMemo, useRef, useState, type RefObject } from "react";
import { Check, ChevronDown, Globe, Link as LinkIcon, Trash2 } from "lucide-react";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { Avatar } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives/Button";
import { Pill } from "@/components/primitives/Pill";
import { Switch } from "@/components/topbar/Switch";
import { features, routes } from "@/config/app.config";
import { cn } from "@/lib/utils/cn";
import { MEMBER_ROLES, type Id, type MemberRole } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";

/**
 * Canonical role labels. Exported so the members modal and any future access
 * surface render the same words — a role reading "Can edit" in one dialog and
 * "Editor" in another is the kind of drift that erodes trust in a permissions
 * UI.
 */
export const ROLE_LABELS: Record<MemberRole, string> = {
  full_access: "Full access",
  can_edit: "Can edit",
  can_comment: "Can comment",
  can_view: "Can view",
};

export const ROLE_HINTS: Record<MemberRole, string> = {
  full_access: "Edit, suggest, comment and share with others",
  can_edit: "Edit, suggest and comment",
  can_comment: "View and comment",
  can_view: "View only",
};

/* ------------------------------------------------------------ role picker -- */

export interface RoleSelectProps {
  role: MemberRole;
  onChange: (role: MemberRole) => void;
  onRemove?: () => void;
  /** Owners cannot be demoted or removed. */
  disabled?: boolean;
}

/** The `Full access ▾` dropdown that trails every member row. */
export function RoleSelect({ role, onChange, onRemove, disabled }: RoleSelectProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-xs",
          "transition-colors duration-100 outline-hidden",
          disabled ? "cursor-default" : "hover:bg-[var(--bac-int)]",
        )}
        style={{ color: "var(--tex-sec)" }}
      >
        {ROLE_LABELS[role]}
        {disabled ? null : <ChevronDown size={12} />}
      </button>

      <Popover open={open} onOpenChange={setOpen} anchor={anchor} align="end" width={260}>
        <MenuList>
          {MEMBER_ROLES.map((option) => (
            <MenuItem
              key={option}
              selected={option === role}
              onSelect={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span className="flex flex-col">
                <span>{ROLE_LABELS[option]}</span>
                <span className="text-[11px]" style={{ color: "var(--tex-ter)" }}>
                  {ROLE_HINTS[option]}
                </span>
              </span>
            </MenuItem>
          ))}
          {onRemove ? (
            <>
              <MenuSeparator />
              <MenuItem
                danger
                icon={<Trash2 size={14} />}
                onSelect={() => {
                  onRemove();
                  setOpen(false);
                }}
              >
                Remove
              </MenuItem>
            </>
          ) : null}
        </MenuList>
      </Popover>
    </>
  );
}

/* ----------------------------------------------------------- share popover -- */

export interface SharePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  pageId: Id;
}

type Tab = "share" | "publish";

export function SharePopover({ open, onOpenChange, anchor, pageId }: SharePopoverProps) {
  const page = useWorkspaceStore((s) => s.pages[pageId]);
  const users = useWorkspaceStore((s) => s.users);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const invitePageMember = useWorkspaceStore((s) => s.invitePageMember);
  const setPageMemberRole = useWorkspaceStore((s) => s.setPageMemberRole);
  const removePageMember = useWorkspaceStore((s) => s.removePageMember);
  const setPagePublished = useWorkspaceStore((s) => s.setPagePublished);

  const [tab, setTab] = useState<Tab>("share");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("full_access");
  const [copied, setCopied] = useState<"link" | "public" | null>(null);

  const members = useMemo(() => page?.members ?? [], [page]);

  const pageUrl = useMemo(() => {
    if (typeof window === "undefined") return routes.page(pageId);
    return `${window.location.origin}${routes.page(pageId)}`;
  }, [pageId]);

  const publicUrl = useMemo(() => {
    const slug = (page?.title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `https://${workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.notion.site/${slug || "untitled"}`;
  }, [page?.title, workspace.name]);

  const copy = (text: string, which: "link" | "public") => {
    void navigator.clipboard?.writeText(text);
    setCopied(which);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const submitInvite = () => {
    const value = email.trim();
    if (!value) return;
    invitePageMember(pageId, value, inviteRole);
    setEmail("");
  };

  if (!page) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} align="end" width={440}>
      {features.publishToWeb ? (
        <div className="flex items-center gap-1 border-b px-3 pt-2" style={{ borderColor: "var(--bor-pri)" }}>
          {(["share", "publish"] as Tab[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className="relative px-2 pb-2 text-sm capitalize transition-colors duration-100 outline-hidden"
              style={{
                color: tab === value ? "var(--tex-pri)" : "var(--tex-sec)",
                fontWeight: tab === value ? 500 : 400,
              }}
            >
              {value}
              {/* The underline is the only tab affordance, as in Notion. */}
              <span
                className="absolute inset-x-0 bottom-0 h-[2px] rounded-full transition-opacity duration-100"
                style={{
                  background: "var(--tex-pri)",
                  opacity: tab === value ? 1 : 0,
                }}
              />
            </button>
          ))}
        </div>
      ) : null}

      {tab === "share" || !features.publishToWeb ? (
        <div>
          {/* Invite row */}
          <div className="flex items-center gap-2 p-3">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitInvite();
              }}
              placeholder="Email or group, separated by commas"
              className="min-w-0 flex-1 rounded-[4px] px-2 py-1.5 text-sm outline-hidden"
              style={{
                background: "var(--bac-int)",
                color: "var(--tex-pri)",
              }}
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as MemberRole)}
              aria-label="Invite role"
              className="shrink-0 rounded-[4px] px-1.5 py-1.5 text-xs outline-hidden"
              style={{ background: "var(--bac-int)", color: "var(--tex-sec)" }}
            >
              {MEMBER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={submitInvite} disabled={!email.trim()}>
              Invite
            </Button>
          </div>

          {/* Member list */}
          <div className="notion-scroller max-h-[280px] overflow-y-auto pb-1">
            <p className="px-3 pb-1 text-[11px] font-medium" style={{ color: "var(--tex-ter)" }}>
              People with access
            </p>

            {members.length === 0 ? (
              <p className="px-3 py-2 text-xs" style={{ color: "var(--tex-ter)" }}>
                Only workspace members with access to the parent page can see this.
              </p>
            ) : (
              members.map((member) => {
                const user = users[member.userId];
                return (
                  <div key={member.userId} className="flex items-center gap-2 px-3 py-1.5">
                    <Avatar user={user} size={24} pending={member.invitePending} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm" style={{ color: "var(--tex-pri)" }}>
                          {user?.name ?? "Unknown"}
                        </span>
                        {member.invitePending ? (
                          <Pill size="sm" color="yellow">
                            Pending
                          </Pill>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs" style={{ color: "var(--tex-ter)" }}>
                        {user?.email}
                      </span>
                    </span>
                    <RoleSelect
                      role={member.role}
                      onChange={(role) => setPageMemberRole(pageId, member.userId, role)}
                      onRemove={() => removePageMember(pageId, member.userId)}
                    />
                  </div>
                );
              })
            )}
          </div>

          {/* Copy link footer */}
          <div className="border-t p-2" style={{ borderColor: "var(--bor-pri)" }}>
            <button
              type="button"
              onClick={() => copy(pageUrl, "link")}
              className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-sm transition-colors duration-100 outline-hidden hover:bg-[var(--bac-int)]"
              style={{ color: "var(--tex-sec)" }}
            >
              {copied === "link" ? (
                <Check size={14} style={{ color: "var(--tag-green-fg)" }} />
              ) : (
                <LinkIcon size={14} />
              )}
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3">
          <div className="flex items-start gap-2">
            <Globe size={16} className="mt-0.5 shrink-0" style={{ color: "var(--ico-sec)" }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={{ color: "var(--tex-pri)" }}>
                Publish to web
              </p>
              <p className="text-xs" style={{ color: "var(--tex-ter)" }}>
                Anyone with the link can view this page.
              </p>
            </div>
            <Switch
              label="Publish to web"
              checked={Boolean(page.isPublished)}
              onChange={(next) => setPagePublished(pageId, next)}
            />
          </div>

          {page.isPublished ? (
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={publicUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-[4px] px-2 py-1.5 text-xs outline-hidden"
                style={{ background: "var(--bac-int)", color: "var(--tex-sec)" }}
              />
              <Button onClick={() => copy(publicUrl, "public")}>
                {copied === "public" ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}
