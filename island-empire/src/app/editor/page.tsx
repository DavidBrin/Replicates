import { Suspense } from "react";

import { Editor } from "@/components/editor/Editor";

export const metadata = { title: "Map Editor — Island Empire" };

/** `useSearchParams` (for `?from=`) needs a Suspense boundary at the page. */
export default function EditorPage() {
  return (
    <Suspense fallback={<main className="p-4 text-white">Loading editor…</main>}>
      <Editor />
    </Suspense>
  );
}
