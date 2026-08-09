"use client";

/**
 * Workspace entry point.
 *
 * There is no separate "home" screen: entering the workspace lands you on the
 * first shared page, which is how a real Notion workspace behaves. The
 * redirect runs in an effect (never during render) so it cannot fire on the
 * server pass.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { routes } from "@/config/app.config";
import { useWorkspaceStore } from "@/lib/store/workspace-store";

export default function WorkspaceIndexPage() {
  const router = useRouter();

  // Selecting a single string keeps this subscription stable — no useShallow
  // needed, and no re-render when unrelated parts of the workspace change.
  const landingPageId = useWorkspaceStore((state) => {
    const ordered = [...state.workspace.sections].sort((a, b) =>
      a.kind === "shared" ? -1 : b.kind === "shared" ? 1 : 0,
    );
    for (const section of ordered) {
      const first = section.pageIds.find((id) => state.pages[id] && !state.pages[id].inTrash);
      if (first) return first;
    }
    return null;
  });

  useEffect(() => {
    if (landingPageId) router.replace(routes.page(landingPageId));
  }, [landingPageId, router]);

  if (landingPageId) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <p style={{ color: "var(--tex-sec)" }}>This workspace has no pages yet.</p>
      <button
        type="button"
        onClick={() => {
          const id = useWorkspaceStore.getState().createPage({ title: "Untitled" });
          router.push(routes.page(id));
        }}
        className="rounded-[4px] px-3 py-1.5 text-sm font-medium"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        Create a page
      </button>
    </div>
  );
}
