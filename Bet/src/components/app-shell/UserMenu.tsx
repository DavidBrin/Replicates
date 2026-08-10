"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { formatCredits } from "@/domain/formatters";
import type { Credits } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface UserMenuProps {
  handle: string;
  displayName: string;
  avatarInitials: string;
  avatarColor: string;
  balance: Credits;
  className?: string;
}

/**
 * The top-bar avatar menu (task-9-brief: "handle, balance via
 * formatCredits, Sign out"). Client component — it owns open/closed state
 * and the sign-out network call.
 */
export function UserMenu({
  handle,
  displayName,
  avatarInitials,
  avatarColor,
  balance,
  className,
}: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      router.push("/signin");
      router.refresh();
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-(--radius-input) py-1 pr-1 pl-1 transition-colors hover:bg-(--surface-3)",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
        )}
      >
        <Avatar initials={avatarInitials} color={avatarColor} size="sm" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-40 mt-2 w-56 rounded-(--radius-card) border border-(--border) bg-(--surface-2) p-3 shadow-2xl"
        >
          <div className="flex items-center gap-2.5 pb-3">
            <Avatar initials={avatarInitials} color={avatarColor} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-(--text-1)">{displayName}</p>
              <p className="truncate text-xs text-(--text-2) tabular-nums">@{handle}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-(--radius-input) bg-(--surface-3) px-3 py-2">
            <span className="text-xs text-(--text-2)">Balance</span>
            <span data-testid="topbar-balance" className="tnum text-sm font-semibold text-(--text-1)">
              {formatCredits(balance)}
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className={cn(
              "mt-2 flex w-full items-center gap-2 rounded-(--radius-input) px-3 py-2 text-left text-sm text-(--text-2) transition-colors hover:bg-(--surface-3) hover:text-(--text-1) disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
            )}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
