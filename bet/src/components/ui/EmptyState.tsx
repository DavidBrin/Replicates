import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Usually a `<Button>`. */
  action?: ReactNode;
  className?: string;
}

/** Centered empty-state block — "no groups yet", "no messages yet", etc.
 * Server-renderable. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-(--radius-card) border border-dashed border-(--border) px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-1 text-(--text-3)">{icon}</div> : null}
      <p className="text-sm font-medium text-(--text-1)">{title}</p>
      {description ? <p className="max-w-sm text-sm text-(--text-2)">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
