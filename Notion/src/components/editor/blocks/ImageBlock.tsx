"use client";

import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";

import { useWorkspaceStore } from "@/lib/store/workspace-store";
import type { BlockComponentProps } from "./shared";

export function ImageBlock({ block }: BlockComponentProps) {
  const patchBlock = useWorkspaceStore((state) => state.patchBlock);
  const [editingUrl, setEditingUrl] = useState(false);
  const [draft, setDraft] = useState("");

  if (!block.url) {
    return (
      <div contentEditable={false} className="my-1">
        {editingUrl ? (
          <form
            className="flex gap-2 rounded-[4px] p-2"
            style={{ background: "var(--bac-sec)" }}
            onSubmit={(event) => {
              event.preventDefault();
              const url = draft.trim();
              if (url) patchBlock(block.id, { url });
              setEditingUrl(false);
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => setEditingUrl(false)}
              placeholder="Paste an image link…"
              className="flex-1 rounded-[4px] border px-2 py-1 text-sm outline-hidden"
              style={{
                borderColor: "var(--bor-pri)",
                background: "var(--bac-pri)",
                color: "var(--tex-pri)",
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditingUrl(true)}
            className="flex w-full items-center gap-3 rounded-[4px] px-4 py-3 text-sm transition-colors duration-100 hover:bg-[var(--bac-int)]"
            style={{ background: "var(--bac-sec)", color: "var(--tex-sec)" }}
          >
            <ImageIcon size={18} strokeWidth={1.5} />
            Add an image
          </button>
        )}
      </div>
    );
  }

  return (
    <figure contentEditable={false} className="my-1">
      {/* Plain <img>: sources are arbitrary user-supplied URLs, which
          next/image would need an explicit remotePatterns allow-list for. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.url}
        alt={block.caption ?? ""}
        className="max-w-full rounded-[3px]"
      />
      {block.caption ? (
        <figcaption className="mt-1 text-xs" style={{ color: "var(--tex-ter)" }}>
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
