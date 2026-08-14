"use client";

/**
 * A workspace role, as a native `<select>`.
 *
 * Native rather than the design system's {@link Combobox} for one reason that
 * outranks the styling: a role is a *form control whose current value is part
 * of the assertion*. `e2e/permissions.spec.ts` reads it with `toHaveValue` and
 * writes it with `selectOption`, and a listbox built from buttons has neither.
 *
 * ## The control is never disabled for the last owner
 *
 * The tempting version greys out the option that would demote the last owner.
 * That is a policy decision taken in a component, and it is taken against a
 * count the browser cannot know is still true — the other owner may have been
 * demoted in another tab a second ago. The rule lives in a transaction that
 * locks the workspace row (`domain/services/membership.ts`), so the control
 * stays live, the server refuses, and the refusal is what the person reads.
 * The e2e spec asserts exactly that ordering.
 *
 * `disabled` exists for the one reason that is *not* a policy decision: the
 * previous change to this same person is still in flight. See the note at the
 * top of `members-table.tsx` — busy is not forbidden.
 */

import { WORKSPACE_ROLES, type WorkspaceRole } from "@/domain/entities";
import { cn } from "@/lib/cn";

/**
 * Sentence case, in rank order.
 *
 * A `Record` keyed by the role type rather than a `.map` over the enum, so
 * adding a role is a compile error here instead of a blank option in a menu.
 */
export const WORKSPACE_ROLE_LABELS: Readonly<Record<WorkspaceRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

export interface RoleSelectProps {
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
  /** Goes on the element itself so a row can scope its assertions to it. */
  testId: string;
  label: string;
  disabled?: boolean;
  className?: string;
}

export function RoleSelect({
  value,
  onChange,
  testId,
  label,
  disabled = false,
  className,
}: RoleSelectProps) {
  return (
    <select
      data-testid={testId}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value as WorkspaceRole);
      }}
      className={cn(
        "h-7 rounded-[var(--radius-md)] border border-default bg-elevated px-2",
        "text-small text-primary transition-colors duration-[var(--speed-quick)]",
        "hover:border-strong focus:border-[var(--border-focus)] focus:outline-none",
        "disabled:cursor-not-allowed disabled:text-quaternary",
        className,
      )}
    >
      {WORKSPACE_ROLES.map((role) => (
        <option key={role} value={role}>
          {WORKSPACE_ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}
