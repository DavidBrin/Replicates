"use client";

import Link from "next/link";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  MoreHorizontalIcon,
  StarFilledIcon,
  StarIcon,
} from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";

import type { DetailSiblings } from "./types";

/**
 * The detail view's 44px bar: `ENG-123  Title`, a star, `⋯`, and `n / m`.
 *
 * Two details from the capture in `research/screenshots/`, both easy to get
 * subtly wrong:
 *
 * - The identifier is **tertiary and the title is primary**, set at the same
 *   13px chrome size and separated by a wide gap rather than a `/` or a `›`.
 *   The bar is not a breadcrumb; it is a label for the pane.
 * - The `n / m` counter sits hard right with **down before up** — the arrows are
 *   ordered as the list is traversed (`J` then `K`), not as a spinner would be.
 */

export interface IssueHeaderProps {
  identifier: string;
  title: string;
  workspaceUrlKey: string;
  siblings: DetailSiblings;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onOpenMenu: () => void;
}

export function IssueHeader({
  identifier,
  title,
  workspaceUrlKey,
  siblings,
  isFavorite,
  onToggleFavorite,
  onOpenMenu,
}: IssueHeaderProps) {
  const href = (target: string | null): string | null =>
    target === null ? null : `/${workspaceUrlKey}/issue/${target}`;

  return (
    <header
      data-testid="issue-header"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-subtle px-4",
        "[height:var(--header-height)]",
      )}
    >
      <span className="shrink-0 text-small text-tertiary">{identifier}</span>
      <span className="min-w-0 flex-1 truncate text-small text-primary">{title}</span>

      <Tooltip content={isFavorite ? "Remove from favourites" : "Add to favourites"}>
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          aria-label={isFavorite ? "Remove from favourites" : "Add to favourites"}
          aria-pressed={isFavorite}
          data-testid="issue-favorite"
          onClick={onToggleFavorite}
        >
          {isFavorite ? (
            <StarFilledIcon size={14} className="text-[var(--warning)]" />
          ) : (
            <StarIcon size={14} />
          )}
        </Button>
      </Tooltip>

      <Button
        iconOnly
        size="sm"
        variant="ghost"
        aria-label="Issue actions"
        data-testid="issue-more"
        onClick={onOpenMenu}
      >
        <MoreHorizontalIcon size={14} />
      </Button>

      <div className="ml-2 flex items-center gap-1 text-micro text-tertiary">
        <span data-testid="issue-position">
          {siblings.index} / {siblings.total}
        </span>
        <NavArrow
          href={href(siblings.nextIdentifier)}
          label="Next issue"
          testId="issue-next"
        >
          <ChevronDownIcon size={14} />
        </NavArrow>
        <NavArrow
          href={href(siblings.previousIdentifier)}
          label="Previous issue"
          testId="issue-prev"
        >
          <ChevronUpIcon size={14} />
        </NavArrow>
      </div>
    </header>
  );
}

/**
 * An arrow that is a link when there is somewhere to go and a disabled button
 * when there is not.
 *
 * Not a link with `aria-disabled`: a disabled anchor is still in the tab order
 * and still navigable by keyboard in most browsers, so the first and last issue
 * in a list would appear to wrap.
 */
function NavArrow({
  href,
  label,
  testId,
  children,
}: {
  href: string | null;
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  const className = cn(
    "inline-flex size-6 items-center justify-center rounded-[var(--radius-md)]",
    "text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary",
  );

  if (href === null) {
    return (
      <button
        type="button"
        disabled
        aria-label={label}
        data-testid={testId}
        className={cn(className, "opacity-40")}
      >
        {children}
      </button>
    );
  }

  return (
    <Link href={href} aria-label={label} data-testid={testId} className={className}>
      {children}
    </Link>
  );
}
