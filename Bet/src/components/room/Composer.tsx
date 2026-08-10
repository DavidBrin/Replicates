"use client";

import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/cn";

export interface ComposerProps {
  onSend: (body: string) => void | Promise<void>;
  disabled?: boolean;
  /** Shown as the field's placeholder and its `title` while disabled — every
   * disabled control in this app carries an explicit reason (G9/SPEC §5.2's
   * discipline, applied here too). */
  disabledReason?: string;
  className?: string;
}

/** The Room's message composer (SPEC §5.4): sends on `⌘↵`/`Ctrl↵` or the
 * Send button. Client component — it owns the draft text and in-flight
 * send state. */
export function Composer({ onSend, disabled, disabledReason, className }: ComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const isDisabled = !!disabled || sending;

  async function submit(): Promise<void> {
    const body = value.trim();
    if (!body || isDisabled) return;
    setSending(true);
    setValue("");
    try {
      await onSend(body);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className={cn("flex items-end gap-2 border-t border-(--border) p-3", className)}>
      <Textarea
        rows={1}
        placeholder={disabled ? (disabledReason ?? "You can't post here") : "Message… (⌘↵ to send)"}
        title={disabled ? disabledReason : undefined}
        value={value}
        disabled={isDisabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-9 flex-1 resize-none"
        aria-label="Message"
      />
      <Button
        type="button"
        size="sm"
        disabled={isDisabled || value.trim().length === 0}
        loading={sending}
        onClick={submit}
      >
        Send
      </Button>
    </div>
  );
}
