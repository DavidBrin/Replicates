"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

const EMOJI_CHOICES = ["⚽", "🏠", "🏆", "🎮", "🍕", "🎬", "🎲", "🏋️", "🌮", "🎉"];

export interface CreateGroupButtonProps {
  /** `"icon"` (default) renders the trailing `+` in `TopBar`'s tab strip;
   * `"cta"` renders a full-width primary button for the onboarding empty
   * state (task-9-brief: "an onboarding EmptyState with a Create your
   * first group CTA"). Same component, same modal + submit flow either
   * way — only the trigger's presentation differs. */
  variant?: "icon" | "cta";
  className?: string;
}

/**
 * Opens a small "create a group" modal (name + emoji), posts to
 * `POST /api/groups`, and routes into the new group on success. Client
 * component: it owns the modal's open state and the form submission.
 */
export function CreateGroupButton({ variant = "icon", className }: CreateGroupButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setEmoji(EMOJI_CHOICES[0]);
    setError(null);
    setPending(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, emoji }),
      });
      const body: { data?: { group?: { slug: string } }; error?: { message?: string } } =
        await res.json();
      if (!res.ok || body.error || !body.data?.group) {
        setError(body.error?.message ?? "Couldn't create the group.");
        setPending(false);
        return;
      }
      setOpen(false);
      reset();
      router.push(`/app/g/${body.data.group.slug}`);
      router.refresh();
    } catch {
      setError("Couldn't create the group. Try again.");
      setPending(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Create a group"
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-(--radius-input) text-(--text-2) transition-colors hover:bg-(--surface-3) hover:text-(--text-1)",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
            className,
          )}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <Button variant="primary" onClick={() => setOpen(true)} className={className}>
          <Plus className="size-4" aria-hidden="true" />
          Create your first group
        </Button>
      )}

      <Modal open={open} onClose={close} title="Create a group">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="group-name" className="text-sm font-medium text-(--text-1)">
              Group name
            </label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sunday League"
              maxLength={60}
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-(--text-1)">Emoji</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Group emoji">
              {EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={choice === emoji}
                  onClick={() => setEmoji(choice)}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-(--radius-input) border text-lg transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-0)",
                    choice === emoji
                      ? "border-(--accent) bg-(--accent)/15"
                      : "border-(--border) hover:border-(--border-2)",
                  )}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-(--no)">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={name.trim().length === 0}>
              Create group
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
