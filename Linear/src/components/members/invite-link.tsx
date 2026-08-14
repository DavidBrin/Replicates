"use client";

/**
 * The link an invitation actually is.
 *
 * There is no email provider on this host, so `lib/auth/invites.ts` mints a
 * bearer token and hands back the plaintext exactly once — the database keeps
 * only `sha256(token)`. That has a blunt consequence for this component: **the
 * link cannot be shown again.** Closing the modal without copying it means
 * minting a new invitation, and the copy below says so rather than leaving
 * somebody to discover it.
 *
 * A read-only `<input>` rather than a `<code>` block because the value has to
 * be selectable and readable by the e2e suite (`inputValue()`), and because
 * "select the text in this div" is a worse copy affordance than a field that
 * selects itself on focus.
 */

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface InviteLinkProps {
  url: string;
}

export function InviteLink({ url }: InviteLinkProps) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2_000);
    } catch {
      // A denied clipboard permission is not an error worth a toast: the field
      // is right there and selectable, which is the fallback anyway.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="invite-link-field"
        className="text-mini font-[var(--weight-medium)] text-tertiary"
      >
        Invitation link
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="invite-link-field"
          data-testid="invite-link"
          readOnly
          value={url}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          containerClassName="flex-1"
        />
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-mini text-tertiary">
        Anyone with this link can join. It is shown once — only its hash is
        stored, so closing this dialog without copying means creating a new
        invitation.
      </p>
    </div>
  );
}
