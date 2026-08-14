"use client";

/**
 * Invitations that have been minted and not yet used.
 *
 * The link is deliberately absent. Only `sha256(token)` reaches the database,
 * so there is nothing here to re-display and no "copy link" affordance to
 * offer; revoking and minting a fresh one is the honest replacement, and it is
 * the option this list gives (`lib/auth/invites.ts`, `DECISIONS.md` D11).
 *
 * `email` is shown because it is what an admin wrote down about who a link was
 * meant for. It is a note, not an authentication factor — nothing checks it at
 * acceptance, and the copy avoids implying otherwise.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { WorkspaceId, WorkspaceRole } from "@/domain/entities";

import { callApi, refusalMessage } from "./mutations";
import { RefusalToast } from "./refusal-toast";
import { WORKSPACE_ROLE_LABELS } from "./role-select";

export interface PendingInviteView {
  readonly id: string;
  readonly email: string | null;
  readonly role: WorkspaceRole;
  readonly expiresAt: string;
}

export interface PendingInvitesProps {
  workspaceId: WorkspaceId;
  invites: readonly PendingInviteView[];
}

export function PendingInvites({ workspaceId, invites }: PendingInvitesProps) {
  const router = useRouter();
  const [revoked, setRevoked] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const visible = invites.filter((invite) => !revoked.includes(invite.id));
  if (visible.length === 0) return null;

  async function revoke(inviteId: string): Promise<void> {
    setRevoked((current) => [...current, inviteId]);
    const result = await callApi("/api/invites", {
      method: "DELETE",
      body: { workspaceId, inviteId },
    });
    if (result.ok) {
      router.refresh();
      return;
    }
    setRevoked((current) => current.filter((id) => id !== inviteId));
    setRefusal(refusalMessage(result.failure));
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-mini font-[var(--weight-medium)] text-tertiary">
        Pending invitations
      </h2>
      <ul className="flex flex-col rounded-[var(--radius-lg)] border border-subtle">
        {visible.map((invite) => (
          <li
            key={invite.id}
            data-testid={`invite-row-${invite.id}`}
            className="flex items-center gap-3 border-b border-subtle px-3 py-2 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-small text-primary">
              {invite.email ?? "Anyone with the link"}
            </span>
            <span className="text-mini text-tertiary">
              {WORKSPACE_ROLE_LABELS[invite.role]}
            </span>
            <span className="text-micro text-quaternary">
              expires{" "}
              {new Date(invite.expiresAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Revoke the invitation for ${invite.email ?? "anyone with the link"}`}
              onClick={() => {
                void revoke(invite.id);
              }}
            >
              Revoke
            </Button>
          </li>
        ))}
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
