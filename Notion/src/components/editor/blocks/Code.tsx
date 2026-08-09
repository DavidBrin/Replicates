"use client";

import { useRef, useState } from "react";

import { MenuItem, MenuList } from "@/components/primitives/Menu";
import { Popover } from "@/components/primitives/Popover";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { Editable } from "../Editable";
import type { BlockComponentProps } from "./shared";

/** The languages Notion's picker opens on; enough to be useful, not a menu wall. */
const LANGUAGES = [
  "plain text",
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "markdown",
  "python",
  "sql",
  "typescript",
  "yaml",
];

export function Code({ block }: BlockComponentProps) {
  const patchBlock = useWorkspaceStore((state) => state.patchBlock);
  const labelRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const language = block.language ?? "plain text";

  return (
    <div
      className="group/code relative"
      style={{
        marginTop: 4,
        borderRadius: 4,
        background: "var(--bac-sec)",
        padding: "32px 16px 16px",
      }}
    >
      <button
        ref={labelRef}
        type="button"
        contentEditable={false}
        onClick={() => setMenuOpen((open) => !open)}
        className="absolute left-2 top-2 rounded-[4px] px-2 py-[2px] text-xs transition-colors duration-100 hover:bg-[var(--bac-int-strong)]"
        style={{ color: "var(--tex-sec)" }}
      >
        {language}
      </button>

      {/* `pre-wrap` (not `pre`) so a long line wraps instead of forcing the
          page into horizontal scroll, matching Notion's default code block. */}
      <Editable
        blockId={block.id}
        className="font-mono"
        style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", tabSize: 2 }}
      />

      <Popover open={menuOpen} onOpenChange={setMenuOpen} anchor={labelRef} width={180}>
        <MenuList className="max-h-72 overflow-y-auto">
          {LANGUAGES.map((entry) => (
            <MenuItem
              key={entry}
              selected={entry === language}
              onSelect={() => {
                patchBlock(block.id, { language: entry });
                setMenuOpen(false);
              }}
            >
              {entry}
            </MenuItem>
          ))}
        </MenuList>
      </Popover>
    </div>
  );
}
