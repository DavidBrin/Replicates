"use client";

import Link from "next/link";
import { routes } from "@/config/app.config";
import { TopBar } from "@/components/topbar/TopBar";
import { PageEditor } from "@/components/editor/PageEditor";
import { useWorkspaceStore } from "@/lib/store/workspace-store";

/**
 * Renders one page: the top bar plus the editor, in a single scroll container
 * so the cover image scrolls under a sticky top bar exactly as it does in
 * Notion.
 */
export function PageRoute({ pageId }: { pageId: string }) {
  const exists = useWorkspaceStore((state) => Boolean(state.pages[pageId]));
  const inTrash = useWorkspaceStore((state) => state.pages[pageId]?.inTrash ?? false);

  if (!exists) return <MissingPage />;

  return (
    <>
      <TopBar pageId={pageId} />
      {inTrash ? <TrashNotice pageId={pageId} /> : null}
      <div className="notion-scroller flex-1 overflow-y-auto">
        <PageEditor pageId={pageId} />
      </div>
    </>
  );
}

function MissingPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg font-medium">This page does not exist</p>
      <p className="text-sm" style={{ color: "var(--tex-sec)" }}>
        It may have been deleted, or the link may be wrong.
      </p>
      <Link
        href={routes.workspace}
        className="mt-2 rounded-[4px] px-3 py-1.5 text-sm font-medium"
        style={{ background: "var(--bac-int)", color: "var(--tex-pri)" }}
      >
        Back to the workspace
      </Link>
    </div>
  );
}

function TrashNotice({ pageId }: { pageId: string }) {
  const restorePage = useWorkspaceStore((state) => state.restorePage);
  return (
    <div
      className="flex items-center justify-center gap-3 px-4 py-2 text-[13px]"
      style={{ background: "var(--tag-red-bg)", color: "var(--tag-red-fg)" }}
    >
      <span>This page is in the trash.</span>
      <button
        type="button"
        onClick={() => restorePage(pageId)}
        className="rounded-[4px] px-2 py-0.5 font-medium underline underline-offset-2"
      >
        Restore page
      </button>
    </div>
  );
}
