"use client";

import Link from "next/link";

import { routes } from "@/config/app.config";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import type { BlockComponentProps } from "./shared";

export function ChildPageLink({ block }: BlockComponentProps) {
  const page = useWorkspaceStore((state) =>
    block.targetId ? state.pages[block.targetId] : undefined,
  );

  const title = page?.title?.trim() || "Untitled";
  const icon = page?.icon.type === "emoji" ? page.icon.emoji : "📄";

  const body = (
    <>
      <span className="shrink-0 text-[18px] leading-none">{icon}</span>
      <span
        className="truncate font-medium underline decoration-[var(--bor-str)] underline-offset-2"
        style={{ color: "var(--tex-pri)" }}
      >
        {title}
      </span>
    </>
  );

  // A page block whose target was deleted still has to render something the
  // user can select and remove.
  if (!block.targetId || !page) {
    return (
      <div
        contentEditable={false}
        className="flex items-center gap-2 rounded-[3px] px-1 py-[3px]"
        style={{ color: "var(--tex-ter)" }}
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={routes.page(block.targetId)}
      contentEditable={false}
      className="flex items-center gap-2 rounded-[3px] px-1 py-[3px] transition-colors duration-100 hover:bg-[var(--bac-int)]"
    >
      {body}
    </Link>
  );
}
