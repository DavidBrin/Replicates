"use client";

/**
 * The menu behind the ⠿ handle: delete, duplicate, turn into, colour.
 *
 * Notion opens "Turn into" and "Color" as nested flyouts. This renders them as
 * views inside the same panel instead — same reachability, none of the
 * second-popover positioning and dismissal machinery.
 */

import { useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Copy, Palette, Repeat2, Trash2 } from "lucide-react";

import { MenuItem, MenuLabel, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { Popover } from "@/components/primitives/Popover";
import { NOTION_COLORS, type Id, type NotionColor } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { tagStyle } from "@/lib/utils/colors";
import { BLOCK_TYPE_META, TURN_INTO_TYPES, applyBlockType } from "./block-types";
import { focusBlock } from "./focus-registry";

type MenuView = "root" | "turn" | "color";

export interface BlockMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  blockId: Id;
}

const COLOR_LABELS: Record<NotionColor, string> = {
  default: "Default",
  gray: "Gray",
  brown: "Brown",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
};

export function BlockMenu({ open, onOpenChange, anchor, blockId }: BlockMenuProps) {
  const block = useWorkspaceStore((state) => state.blocks[blockId]);
  const [view, setView] = useState<MenuView>("root");

  // Reopening should always start at the top level. Folded into the close path
  // rather than an effect on `open`, so there is no render where a reopened
  // menu still shows the submenu it was left on.
  const close = () => {
    setView("root");
    onOpenChange(false);
  };
  const handleOpenChange = (next: boolean) => {
    if (!next) setView("root");
    onOpenChange(next);
  };

  if (!block) return null;

  const duplicate = () => {
    const store = useWorkspaceStore.getState();
    const source = store.blocks[blockId];
    if (!source) return;
    // Children are intentionally not cloned: `insertBlock` mints one block,
    // and a deep copy would need its own id-remapping pass in the store.
    const copyId = store.insertBlock({
      parentId: source.parentId,
      type: source.type,
      text: source.text,
      afterBlockId: blockId,
      patch: {
        color: source.color,
        checked: source.checked,
        expanded: source.expanded,
        emoji: source.emoji,
        language: source.language,
        url: source.url,
        caption: source.caption,
        targetId: source.targetId,
      },
    });
    close();
    focusBlock(copyId, "end");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} anchor={anchor} width={232}>
      {view === "root" ? (
        <MenuList>
          <MenuItem
            icon={<Trash2 size={14} />}
            danger
            onSelect={() => {
              useWorkspaceStore.getState().deleteBlock(blockId);
              close();
            }}
          >
            Delete
          </MenuItem>
          <MenuItem icon={<Copy size={14} />} onSelect={duplicate}>
            Duplicate
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Repeat2 size={14} />}
            hint={<ChevronRight size={14} />}
            onSelect={() => setView("turn")}
          >
            Turn into
          </MenuItem>
          <MenuItem
            icon={<Palette size={14} />}
            hint={<ChevronRight size={14} />}
            onSelect={() => setView("color")}
          >
            Color
          </MenuItem>
        </MenuList>
      ) : null}

      {view === "turn" ? (
        <MenuList className="max-h-80 overflow-y-auto">
          <MenuItem icon={<ChevronLeft size={14} />} onSelect={() => setView("root")}>
            Back
          </MenuItem>
          <MenuLabel>Turn into</MenuLabel>
          {TURN_INTO_TYPES.map((type) => {
            const meta = BLOCK_TYPE_META[type];
            const Icon = meta.icon;
            return (
              <MenuItem
                key={type}
                icon={<Icon size={14} />}
                selected={block.type === type}
                onSelect={() => {
                  applyBlockType(blockId, type);
                  close();
                }}
              >
                {meta.label}
              </MenuItem>
            );
          })}
        </MenuList>
      ) : null}

      {view === "color" ? (
        <MenuList className="max-h-80 overflow-y-auto">
          <MenuItem icon={<ChevronLeft size={14} />} onSelect={() => setView("root")}>
            Back
          </MenuItem>
          <MenuLabel>Color</MenuLabel>
          {/* One list, not Notion's separate "Color" and "Background" lists:
              `Block.color` is a single `NotionColor` with no `_background`
              variants, so the two would write the same field. The swatch shows
              both roles because that is how the value is actually rendered —
              text tint on a text block, wash behind a callout. */}
          {NOTION_COLORS.map((color) => (
            <MenuItem
              key={color}
              selected={(block.color ?? "default") === color}
              icon={
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-[3px] border text-[11px] font-semibold"
                  style={{ ...tagStyle(color), borderColor: "var(--bor-pri)" }}
                >
                  A
                </span>
              }
              onSelect={() => {
                useWorkspaceStore.getState().setBlockColor(blockId, color);
                close();
              }}
            >
              {COLOR_LABELS[color]}
            </MenuItem>
          ))}
        </MenuList>
      ) : null}
    </Popover>
  );
}
