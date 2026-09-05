"use client";

/**
 * The simulated "demo login" prompt.
 *
 * Purely presentational: it holds only the input's local draft value and
 * calls back to the caller on submit or skip. No auth store, no hooks from
 * `src/lib/auth/*` — whoever mounts this owns what happens with the name.
 *
 * Shell shape (scrim + centered card + escape/outside-click dismissal) is
 * copied from `CommandPalette`'s dialog so the two full-screen surfaces in
 * this app feel like one language.
 */

import { useState } from "react";
import { NotionMark } from "@/components/marketing/icons";
import { Button } from "@/components/primitives/Button";
import { demoAuth } from "@/config/app.config";
import { demoLoginCopy } from "./copy";

export interface DemoLoginDialogProps {
  onSignIn: (name: string) => void;
  onSkip: () => void;
}

export function DemoLoginDialog({ onSignIn, onSkip }: DemoLoginDialogProps) {
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSignIn(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(15,15,15,0.72)", backdropFilter: "blur(6px)" }}
      onPointerDown={(event) => {
        // Only a press that starts and ends on the scrim dismisses.
        if (event.target === event.currentTarget) onSkip();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-login-title"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onSkip();
        }}
        className="w-full max-w-[400px] rounded-lg p-6"
        style={{ background: "var(--bac-ele)", boxShadow: "var(--shadow-menu)" }}
      >
        <div className="mb-5 flex flex-col items-center text-center">
          <NotionMark size={32} />
          <h2 id="demo-login-title" className="mt-3 text-xl font-semibold" style={{ color: "var(--tex-pri)" }}>
            {demoLoginCopy.title}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--tex-sec)" }}>
            {demoLoginCopy.deck}
          </p>
        </div>

        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          maxLength={demoAuth.maxNameLength}
          placeholder={demoLoginCopy.placeholder}
          className="w-full rounded-[4px] px-2 py-1.5 text-base outline-hidden"
          style={{ background: "var(--bac-int)", color: "var(--tex-pri)" }}
        />

        <Button
          variant="primary"
          size="lg"
          className="mt-3 w-full"
          disabled={!name.trim()}
          onClick={submit}
        >
          {demoLoginCopy.submit}
        </Button>

        <div
          className="mt-5 rounded-lg border p-3"
          style={{ background: "var(--bac-ter)", borderColor: "var(--bor-pri)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--tex-pri)" }}>
            {demoLoginCopy.disclaimerHeading}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--tex-sec)" }}>
            {demoLoginCopy.disclaimerBody}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--tex-ter)" }}>
            {demoLoginCopy.contactPrefix}
            <a
              href={demoAuth.contactHref}
              className="underline underline-offset-2"
              style={{ color: "var(--tex-sec)" }}
            >
              {demoLoginCopy.contactLabel}
            </a>
          </p>
        </div>

        <Button variant="subtle" size="md" className="mt-3 w-full" onClick={onSkip}>
          {demoLoginCopy.skip}
        </Button>
      </div>
    </div>
  );
}
