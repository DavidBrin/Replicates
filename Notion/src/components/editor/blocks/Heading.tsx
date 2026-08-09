"use client";

import type { CSSProperties } from "react";

import type { BlockType } from "@/lib/model/types";
import { textColor } from "@/lib/utils/colors";
import { Editable } from "../Editable";
import type { BlockComponentProps } from "./shared";

/**
 * Notion's heading ramp. The generous top margin is what separates sections
 * visually — headings carry almost all of the page's vertical rhythm, so it
 * lives here rather than in the shared row metrics.
 */
const HEADING_STYLE: Partial<Record<BlockType, CSSProperties>> = {
  heading_1: { fontSize: 30, marginTop: 32, paddingTop: 3, paddingBottom: 1 },
  heading_2: { fontSize: 24, marginTop: 24, paddingTop: 3, paddingBottom: 1 },
  heading_3: { fontSize: 20, marginTop: 18, paddingTop: 3, paddingBottom: 1 },
};

export function Heading({ block }: BlockComponentProps) {
  const level = HEADING_STYLE[block.type] ?? HEADING_STYLE.heading_1;
  const Tag = block.type === "heading_2" ? "h2" : block.type === "heading_3" ? "h3" : "h1";

  return (
    <Tag
      style={{
        ...level,
        fontWeight: 600,
        lineHeight: 1.3,
        color: textColor(block.color),
      }}
    >
      <Editable blockId={block.id} />
    </Tag>
  );
}
